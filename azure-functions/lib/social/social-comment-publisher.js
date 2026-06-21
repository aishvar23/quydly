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
// Safety / idempotency (mirrors social-publisher.js):
//   - claims each row by flipping SCHEDULED → COMMENTING with a conditional update
//     (comment_status still 'SCHEDULED'); a row that can't be claimed is skipped
//     (another worker already took it / already posted) — so a comment is NEVER
//     posted twice.
//   - on success: comment_status 'POSTED' + comment_platform_id.
//   - on failure: bounded retry — released back to SCHEDULED until comment_attempts
//     reaches MAX_ATTEMPTS, then left FAILED (terminal) with error_message.
//
// Gating: runs only when SOCIAL_IG_ENGAGEMENT_ENABLED is on. If the Meta creds are
// unavailable (META_PAGE_ACCESS_TOKEN unset) it no-ops cleanly without claiming.
// The token must also carry `instagram_manage_comments`; if it doesn't, the Graph
// call fails (code 190/200) and the row retries then FAILs — surfaced via logs.
//
// Dependencies (postComment, getCreds) are injected so tests never hit the network.

import { postComment as igPostComment, credsFromEnv as igCredsFromEnv } from "./instagram-graph.js";

const BATCH = 20;
// How many post attempts before a row is left FAILED (terminal). The 1st claim is
// attempt 1; a transient Graph error releases it for the next window until this cap.
const MAX_ATTEMPTS = 3;

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
