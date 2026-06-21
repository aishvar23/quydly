// Social comment publisher orchestrator (IG engagement "answer" comment).
//
// The IG carousel's engagement slide (second-to-last) poses an MCQ drawn from the
// PREVIOUS post's story. ~12h after the post goes live we reveal the answer as a
// COMMENT on that IG media. The upstream DB side is already live:
//   - social-post-generator writes a social_post_engagement row (comment_status
//     'PENDING') at generation time.
//   - social-publisher arms it on POSTED: sets ig_media_id + comment_due_at
//     (= published_at + 12h) and flips PENDING → SCHEDULED.
// This worker is the final step: it claims due SCHEDULED rows and posts the comment.
//
// Safety / idempotency (mirrors social-publisher.js). A comment is posted
// EXACTLY ONCE across both DB races AND retried posts:
//   - DB race: claims each row by flipping SCHEDULED → COMMENTING with a
//     conditional update (comment_status still 'SCHEDULED'); a row that can't be
//     claimed is skipped (another worker already took it / already posted).
//   - retried post: if a prior attempt actually posted the IG comment but then
//     threw (lost the Graph response), the row was released back to SCHEDULED and
//     would otherwise be re-posted. On any RETRY (comment_attempts ≥ 1) we first
//     call listComments() for the media and, if a comment whose text exactly
//     matches the message we're about to post already exists, treat it as already
//     posted (mark POSTED with that comment id) and SKIP the post. The dedup check
//     is retry-only so the common first attempt makes no extra Graph call.
//   - on success: comment_status 'POSTED' + comment_platform_id.
//   - on failure: bounded retry — released back to SCHEDULED until comment_attempts
//     reaches MAX_ATTEMPTS, then left FAILED (terminal) with error_message.
//   - stuck rows: a row left COMMENTING (post succeeded but the → POSTED update
//     failed) is never re-fetched by the SCHEDULED claim filter, so at the start
//     of each run we reclaim COMMENTING rows older than STUCK_MS back to SCHEDULED;
//     the retry dedup check above then prevents any double-post for ones that did
//     post.
//
// Gating: runs only when SOCIAL_IG_ENGAGEMENT_ENABLED is on. If the Meta creds are
// unavailable (META_PAGE_ACCESS_TOKEN unset) it no-ops cleanly without claiming.
// The token must also carry `instagram_manage_comments`; if it doesn't, the Graph
// call fails (code 190/200) and the row retries then FAILs — surfaced via logs.
//
// Dependencies (postComment, getCreds) are injected so tests never hit the network.

import {
  postComment as igPostComment,
  listComments as igListComments,
  credsFromEnv as igCredsFromEnv,
} from "./instagram-graph.js";

const BATCH = 20;
// How many post attempts before a row is left FAILED (terminal). The 1st claim is
// attempt 1; a transient Graph error releases it for the next window until this cap.
const MAX_ATTEMPTS = 3;
// A row claimed (COMMENTING) but never finalised this long ago is presumed stuck
// (the → POSTED/FAILED update failed after the claim) and reclaimed to SCHEDULED
// so the normal due path can reconcile it (dedup-guarded against double-posting).
const STUCK_MS = 10 * 60 * 1000; // 10 minutes

const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

function isEnabled(env) {
  return /^(1|true)$/i.test(String(env.SOCIAL_IG_ENGAGEMENT_ENABLED || ""));
}

// The answer comment text. Frozen, single source of truth so the test asserts the
// exact format the worker posts.
//   "Yesterday's question: {question} — Answer: {correct option text}. Play the
//    full quiz at quydly.com"
// `answer` is denormalised on the row (options[correct_index]); fall back to the
// option lookup if it's somehow missing.
export function buildCommentMessage(row) {
  const options = Array.isArray(row.options) ? row.options : [];
  const answer = row.answer || options[row.correct_index] || "";
  return `Yesterday's question: ${row.question} — Answer: ${answer}. Play the full quiz at quydly.com`;
}

export async function publishDueComments({
  supabase,
  postComment = igPostComment,
  listComments = igListComments,
  getCreds = igCredsFromEnv,
  env = process.env,
  logger = noopLogger,
  now = new Date(),
} = {}) {
  // Hard gate: feature flag off → no-op.
  if (!isEnabled(env)) {
    logger(JSON.stringify({ event: "social_comment_disabled" }));
    return { posted: 0, failed: 0, skipped: 0 };
  }

  // Resolve IG creds once. If unavailable (token unset / missing var) we no-op
  // WITHOUT claiming any row — leaving them SCHEDULED for a future run. Never let
  // a creds gap burn through the retry budget.
  let creds;
  try {
    creds = getCreds(env);
  } catch (err) {
    logger.warn(JSON.stringify({ event: "social_comment_no_creds", error: err.message }));
    return { posted: 0, failed: 0, skipped: 0 };
  }

  const nowIso = new Date(now).toISOString();

  // Reclaim stuck rows: a row left COMMENTING (claimed, but the → POSTED/FAILED
  // update failed) is never re-fetched by the SCHEDULED claim filter, so release
  // any COMMENTING row older than STUCK_MS back to SCHEDULED. These then flow
  // through the normal due path; the retry dedup check below prevents a double-
  // post for any that actually did post their comment.
  const stuckBefore = new Date(new Date(now).getTime() - STUCK_MS).toISOString();
  const { data: reclaimed, error: reclaimErr } = await supabase
    .from("social_post_engagement")
    .update({ comment_status: "SCHEDULED", updated_at: nowIso })
    .eq("comment_status", "COMMENTING")
    .lt("updated_at", stuckBefore)
    .select("id");
  if (reclaimErr) throw new Error(`[social-comment-publisher] reclaim stuck rows: ${reclaimErr.message}`);
  if (reclaimed && reclaimed.length) {
    logger(JSON.stringify({ event: "social_comment_reclaimed", count: reclaimed.length }));
  }

  // Due, unposted comments: SCHEDULED, due, with an IG media id, oldest first.
  const { data: rows, error } = await supabase
    .from("social_post_engagement")
    .select("id, social_post_id, ig_media_id, question, options, correct_index, answer, comment_status, comment_due_at, comment_attempts")
    .eq("comment_status", "SCHEDULED")
    .lte("comment_due_at", nowIso)
    .not("ig_media_id", "is", null)
    .order("comment_due_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`[social-comment-publisher] fetch due rows: ${error.message}`);
  if (!rows || rows.length === 0) {
    logger(JSON.stringify({ event: "social_comment_none" }));
    return { posted: 0, failed: 0, skipped: 0 };
  }

  let posted = 0, failed = 0, skipped = 0;

  for (const row of rows) {
    // Claim the row: SCHEDULED → COMMENTING, only if STILL SCHEDULED (exactly-once).
    // A lost race (another worker claimed it, or it already POSTED) returns no row.
    const attempts = (row.comment_attempts || 0) + 1;
    const { data: claimed, error: claimErr } = await supabase
      .from("social_post_engagement")
      .update({ comment_status: "COMMENTING", comment_attempts: attempts, updated_at: nowIso })
      .eq("id", row.id)
      .eq("comment_status", "SCHEDULED")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new Error(`[social-comment-publisher] claim ${row.id}: ${claimErr.message}`);
    if (!claimed) { skipped++; continue; } // lost the race / already moved

    const message = buildCommentMessage(row);

    // Retry-only idempotency: if a PRIOR attempt already posted this comment but
    // lost the Graph response (the row was released back to SCHEDULED), posting
    // again would duplicate it. On any retry (row.comment_attempts ≥ 1) list the
    // media's existing comments first; if one's text exactly matches the message
    // we're about to post, it's already posted — mark POSTED and skip postComment.
    // First attempts (the common path) skip this extra Graph call.
    if ((row.comment_attempts || 0) >= 1) {
      try {
        const existing = await listComments({ creds, mediaId: row.ig_media_id, logger });
        const dup = Array.isArray(existing) ? existing.find((c) => c && c.text === message) : null;
        if (dup) {
          await supabase
            .from("social_post_engagement")
            .update({
              comment_status: "POSTED",
              comment_platform_id: dup.id,
              error_message: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          posted++;
          logger(JSON.stringify({
            event: "social_comment_deduped",
            engagement_id: row.id,
            social_post_id: row.social_post_id,
            ig_media_id: row.ig_media_id,
            comment_id: dup.id,
          }));
          continue; // already posted — never post again
        }
      } catch (listErr) {
        // A listComments failure is non-fatal: fall through and attempt the post
        // (the worst case is the duplicate we were trying to avoid, which the next
        // retry's dedup would still catch). Surface it for diagnosis.
        logger.warn(JSON.stringify({ event: "social_comment_dedup_check_failed", engagement_id: row.id, error: listErr.message }));
      }
    }

    try {
      const { commentId } = await postComment({ creds, mediaId: row.ig_media_id, message, logger });
      await supabase
        .from("social_post_engagement")
        .update({
          comment_status: "POSTED",
          comment_platform_id: commentId,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      posted++;
      logger(JSON.stringify({
        event: "social_comment_posted",
        engagement_id: row.id,
        social_post_id: row.social_post_id,
        ig_media_id: row.ig_media_id,
        comment_id: commentId,
      }));
    } catch (postErr) {
      // Bounded retry: under the cap → release to SCHEDULED for the next window;
      // at/over the cap → leave FAILED (terminal). error_message kept either way.
      const terminal = attempts >= MAX_ATTEMPTS;
      await supabase
        .from("social_post_engagement")
        .update({
          comment_status: terminal ? "FAILED" : "SCHEDULED",
          error_message: String(postErr.message).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed++;
      logger.error(JSON.stringify({
        event: terminal ? "social_comment_failed" : "social_comment_retry",
        engagement_id: row.id,
        ig_media_id: row.ig_media_id,
        attempts,
        error: postErr.message,
      }));
    }
  }

  logger(JSON.stringify({ event: "social_comment_complete", posted, failed, skipped }));
  return { posted, failed, skipped };
}
