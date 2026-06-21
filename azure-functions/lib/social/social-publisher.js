// Social publisher orchestrator. Design §9.3 / §12.3.
//
// Publishes APPROVED (or SCHEDULED + due) posts to their platform. MVP = X only.
// Safety / idempotency:
//   - claims each row by flipping APPROVED/SCHEDULED → PUBLISHING with a
//     conditional update (platform_post_id IS NULL); a row that can't be claimed
//     is skipped (another worker / already published).
//   - per-platform per-day cap (SOCIAL_MAX_<P>_POSTS_PER_DAY).
//   - Instagram is never published without a media asset (acceptance #16).
//   - success stores platform_post_id + response; failure stores error_message.
//
// Dependencies (publishers, getToken) are injected so tests never hit the network.

import { publish as xPublish, publishReply as xPublishReply } from "./platforms/x.js";
import { credsFromEnv as xCredsFromEnv } from "./x-oauth1.js";
import { publish as igPublish, credsFromEnv as igCredsFromEnv } from "./instagram-graph.js";
import { publish as fbPublish, credsFromEnv as fbCredsFromEnv } from "./facebook-graph.js";
import { requiresMedia } from "./platforms/index.js";

const BATCH = 20;
const DEFAULT_PUBLISHERS = { x: xPublish, instagram: igPublish, facebook: fbPublish };
// Per-platform credential resolvers (env → creds). Each is called at most once,
// lazily, the first time a post for that platform is published.
const DEFAULT_CREDS_RESOLVERS = { x: xCredsFromEnv, instagram: igCredsFromEnv, facebook: fbCredsFromEnv };

// Whether a platform requires a media asset (media_url) before publishing is
// derived from its CONSTRAINTS.requiresMedia (single source of truth — see
// platforms/index.js): IG (#16) and Facebook (locked single-card-image format).
// A no-media post for such a platform is skipped (it should never have been
// APPROVED — the generator keeps it PENDING_REVIEW — but the gate is enforced
// here defensively too).

const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

function startOfUtcDayIso(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

// Per-platform default daily caps when SOCIAL_MAX_<P>_POSTS_PER_DAY is unset.
// X is 12 (not 24): every published X post now emits a SECOND real tweet — the
// fire-and-forget "answer here" reply — which is NOT counted by this cap. So 12
// primary posts ≈ 24 real tweets/day, matching the prior anti-spam ceiling.
// If SOCIAL_MAX_X_POSTS_PER_DAY is set in Azure, halve it for the same reason.
// (The selector's maxCandidatesPerDayPerGeo is platform-agnostic — shared by
// FB/IG — so it stays at 24; X-only volume is bounded here.)
//
// Instagram is capped at 25 to match Meta's content-publishing quota (25 API
// posts per rolling 24h). At ~17/day supply this never binds in normal
// operation — so there is no artificial throttle and no pile-up to flush in a
// midnight burst. (The old cap of 10 sat BELOW supply, which is exactly what
// caused the backlog + 00:00Z burst.) The cap now matters only as a safety rail:
// if a one-time backlog flush or an abnormal spike would exceed Meta's limit,
// the gate SKIPS the overflow — leaving it APPROVED to publish next window —
// instead of letting Meta reject it and the post get marked FAILED (terminal).
// Override via SOCIAL_MAX_INSTAGRAM_POSTS_PER_DAY. Other platforms keep the
// conservative default.
const DEFAULT_DAILY_CAP = 10;
// Facebook stays in the conservative class (10/day, same as the IG-style media
// gate) — override via SOCIAL_MAX_FACEBOOK_POSTS_PER_DAY through dailyCap().
const PLATFORM_DAILY_CAP_DEFAULTS = { x: 12, instagram: 25, facebook: 10 };

function dailyCap(env, platform) {
  const key = `SOCIAL_MAX_${platform.toUpperCase()}_POSTS_PER_DAY`;
  const v = Number(env[key]);
  if (Number.isFinite(v) && v > 0) return v;
  return PLATFORM_DAILY_CAP_DEFAULTS[platform] ?? DEFAULT_DAILY_CAP;
}

export async function publishApprovedPosts({
  supabase,
  publishers = DEFAULT_PUBLISHERS,
  // X creds resolver (kept named `getCreds` for back-compat); IG/FB mirror it.
  getCreds = xCredsFromEnv,
  getIgCreds = igCredsFromEnv,
  getFbCreds = fbCredsFromEnv,
  // X reply publisher (the "answer here" link comment). Injectable for tests.
  xReplyPublish = xPublishReply,
  env = process.env,
  logger = noopLogger,
  now = new Date(),
} = {}) {
  // Public base for the shareable answer page: <base>/question/<social_question_id>.
  // Defaults to the production host so no env config is needed; override only to
  // point at a non-prod domain.
  const publicBase = String(env.QUYDLY_PUBLIC_BASE_URL || "https://www.quydly.com").replace(/\/+$/, "");
  const enabledPlatforms = Object.keys(publishers);

  // Lazy, per-platform credential resolution. A platform whose creds are
  // unavailable (not configured) has its posts released + skipped — it does not
  // block other platforms (e.g. missing IG creds must not stop X publishing).
  const credsResolvers = { ...DEFAULT_CREDS_RESOLVERS, x: getCreds, instagram: getIgCreds, facebook: getFbCreds };
  const credsCache = new Map();
  const credsUnavailable = new Map();
  function resolveCreds(platform) {
    if (credsCache.has(platform)) return credsCache.get(platform);
    if (credsUnavailable.has(platform)) return null;
    const fn = credsResolvers[platform];
    if (!fn) { credsUnavailable.set(platform, "no resolver"); return null; }
    try {
      const c = fn(env);
      credsCache.set(platform, c);
      return c;
    } catch (err) {
      credsUnavailable.set(platform, err.message);
      logger.error(JSON.stringify({ event: "social_publish_creds_unavailable", platform, error: err.message }));
      return null;
    }
  }

  // Fetch a post's ordered Instagram carousel slides, if any.
  async function carouselSlidesFor(postId) {
    const { data: assets, error: aErr } = await supabase
      .from("social_media_assets")
      .select("asset_url, position")
      .eq("social_post_id", postId)
      .eq("asset_type", "instagram_carousel_slide")
      .order("position", { ascending: true });
    if (aErr) throw new Error(`[social-publisher] fetch slides ${postId}: ${aErr.message}`);
    return (assets || []).map((a) => ({ url: a.asset_url }));
  }

  // Per-platform remaining daily budget — computed BEFORE the fetch so capped
  // platforms can be EXCLUDED from it. A capped platform keeps accumulating
  // APPROVED posts it can't publish today; ordered oldest-first, that backlog
  // sorts to the front of the queue and fills the entire BATCH every run,
  // starving other publishable platforms. (This is exactly what stalled
  // Instagram: once X's capped backlog grew past BATCH rows, every fetch came
  // back all-X, all skipped, and IG never made it into the batch.) Excluding
  // capped platforms keeps the batch full of posts that can actually publish.
  const remaining = {};
  for (const p of enabledPlatforms) {
    const { count } = await supabase
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("platform", p)
      .eq("status", "POSTED")
      .gte("published_at", startOfUtcDayIso(now));
    remaining[p] = dailyCap(env, p) - (count || 0);
  }
  const publishablePlatforms = enabledPlatforms.filter((p) => remaining[p] > 0);
  if (publishablePlatforms.length === 0) {
    logger(JSON.stringify({ event: "social_publish_none", reason: "all_platforms_capped" }));
    return { published: 0, failed: 0, skipped: 0 };
  }

  // Media-required platforms (IG #16, FB) can only publish with a rendered card;
  // a media-less row is skipped in the loop below. Exclude those rows from the
  // fetch itself, or — ordered oldest-first — a backlog of media-less drafts
  // (e.g. legacy AUTO_APPROVED FB rows created before card rendering existed)
  // fills the whole BATCH every run, all skipped, starving publishable platforms.
  // (Same starvation the capped-platform exclusion above prevents.) Keep a row
  // only if it has media OR its platform doesn't require media.
  const mediaOptional = publishablePlatforms.filter((p) => !requiresMedia(p));
  const mediaClause = mediaOptional.length
    ? `media_url.not.is.null,platform.in.(${mediaOptional.join(",")})`
    : "media_url.not.is.null";

  // Due, unpublished posts for platforms that still have budget today.
  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, story_id, platform, audience_geo, post_text, media_url, status, scheduled_for, platform_post_id, social_question_id")
    .in("status", ["APPROVED", "SCHEDULED"])
    .in("platform", publishablePlatforms)
    .is("platform_post_id", null)
    .or(`scheduled_for.is.null,scheduled_for.lte.${new Date(now).toISOString()}`)
    .or(mediaClause)
    .order("scheduled_for", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`[social-publisher] fetch posts: ${error.message}`);
  if (!posts || posts.length === 0) {
    logger(JSON.stringify({ event: "social_publish_none" }));
    return { published: 0, failed: 0, skipped: 0 };
  }

  let published = 0, failed = 0, skipped = 0;

  for (const post of posts) {
    if (remaining[post.platform] <= 0) {
      skipped++;
      logger(JSON.stringify({ event: "social_publish_cap_reached", platform: post.platform, post_id: post.id }));
      continue;
    }

    // Instagram (#16) and Facebook require a media asset before publishing.
    if (requiresMedia(post.platform) && !post.media_url) {
      skipped++;
      logger.warn(JSON.stringify({ event: "social_publish_skip_no_media", platform: post.platform, post_id: post.id }));
      continue;
    }

    // Claim the row (§12.3): APPROVED/SCHEDULED + no tweet id → PUBLISHING.
    const { data: claimed, error: claimErr } = await supabase
      .from("social_posts")
      .update({ status: "PUBLISHING", updated_at: new Date(now).toISOString() })
      .eq("id", post.id)
      .is("platform_post_id", null)
      .in("status", ["APPROVED", "SCHEDULED"])
      .select("id")
      .maybeSingle();

    if (claimErr) throw new Error(`[social-publisher] claim ${post.id}: ${claimErr.message}`);
    if (!claimed) { skipped++; continue; } // lost the race / already moved

    // Resolve this platform's creds. If unavailable, release the claim back to
    // its pre-claim status and skip — other platforms still publish.
    const creds = resolveCreds(post.platform);
    if (!creds) {
      await supabase.from("social_posts").update({ status: post.status }).eq("id", post.id);
      skipped++;
      logger.warn(JSON.stringify({ event: "social_publish_skip_no_creds", platform: post.platform, post_id: post.id }));
      continue;
    }

    try {
      // Instagram may publish a multi-slide carousel — pass its ordered slides.
      const slides = post.platform === "instagram" ? await carouselSlidesFor(post.id) : null;
      const result = await publishers[post.platform](post, { creds, slides, logger });
      const publishedAt = new Date().toISOString();
      await supabase
        .from("social_posts")
        .update({
          status: "POSTED",
          platform_post_id: result.platformPostId,
          platform_response: result.rawResponse,
          published_at: publishedAt,
          updated_at: publishedAt,
          error_message: null,
        })
        .eq("id", post.id);
      published++;
      remaining[post.platform]--;
      logger(JSON.stringify({
        event: "social_published",
        post_id: post.id,
        platform: post.platform,
        platform_post_id: result.platformPostId,
      }));

      // IG engagement: schedule the answer comment. If this post carried an
      // engagement slide, its social_post_engagement row (written PENDING at
      // generation time) is now armed: record the IG media id, set the comment
      // due 12h after publish, and flip PENDING → SCHEDULED. This is a DB write
      // ONLY — no Graph call, so it needs no token scope. Rows accumulate as
      // SCHEDULED, ready for the (deferred) comment-publisher worker to claim
      // once the Meta token gains instagram_manage_comments. NON-FATAL: a failure
      // here only costs the eventual answer comment, never the published post.
      if (post.platform === "instagram") {
        try {
          const commentDueAt = new Date(new Date(publishedAt).getTime() + 12 * 60 * 60 * 1000).toISOString();
          const { error: engErr } = await supabase
            .from("social_post_engagement")
            .update({
              ig_media_id: result.platformPostId,
              comment_due_at: commentDueAt,
              comment_status: "SCHEDULED",
              updated_at: publishedAt,
            })
            .eq("social_post_id", post.id)
            .eq("comment_status", "PENDING");
          if (engErr) throw engErr;
        } catch (engErr) {
          logger.warn(JSON.stringify({
            event: "social_engagement_schedule_failed",
            post_id: post.id,
            error: engErr.message,
          }));
        }
      }

      // Fire-and-forget: reply to the just-published X tweet with the answer-page
      // link. Non-fatal — the parent is already POSTED, so a reply failure only
      // costs the link comment. Not counted against the daily cap by design.
      if (post.platform === "x" && post.social_question_id) {
        try {
          const replyText = `\u{1F440} Check out the answer here: ${publicBase}/question/${post.social_question_id}`;
          const reply = await xReplyPublish({
            text: replyText,
            inReplyToTweetId: result.platformPostId,
            creds,
          });
          logger(JSON.stringify({
            event: "social_reply_published",
            post_id: post.id,
            parent_tweet_id: result.platformPostId,
            reply_tweet_id: reply?.platformPostId,
          }));
        } catch (replyErr) {
          logger.warn(JSON.stringify({
            event: "social_reply_failed",
            post_id: post.id,
            parent_tweet_id: result.platformPostId,
            error: replyErr.message,
          }));
        }
      }
    } catch (pubErr) {
      await supabase
        .from("social_posts")
        .update({
          status: "FAILED",
          error_message: String(pubErr.message).slice(0, 500),
          failed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);
      failed++;
      logger.error(JSON.stringify({ event: "social_publish_failed", post_id: post.id, error: pubErr.message }));
    }
  }

  logger(JSON.stringify({ event: "social_publish_complete", published, failed, skipped }));
  return { published, failed, skipped };
}
