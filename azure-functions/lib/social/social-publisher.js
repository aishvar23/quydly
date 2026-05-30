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

import { publish as xPublish } from "./platforms/x.js";
import { credsFromEnv } from "./x-oauth1.js";

const BATCH = 20;
const DEFAULT_PUBLISHERS = { x: xPublish };

const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

function startOfUtcDayIso(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function dailyCap(env, platform) {
  const key = `SOCIAL_MAX_${platform.toUpperCase()}_POSTS_PER_DAY`;
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

export async function publishApprovedPosts({
  supabase,
  publishers = DEFAULT_PUBLISHERS,
  getCreds = credsFromEnv,
  env = process.env,
  logger = noopLogger,
  now = new Date(),
} = {}) {
  const enabledPlatforms = Object.keys(publishers);

  // Due, unpublished posts for supported platforms.
  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, story_id, platform, audience_geo, post_text, media_url, status, scheduled_for, platform_post_id")
    .in("status", ["APPROVED", "SCHEDULED"])
    .in("platform", enabledPlatforms)
    .is("platform_post_id", null)
    .or(`scheduled_for.is.null,scheduled_for.lte.${new Date(now).toISOString()}`)
    .order("scheduled_for", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`[social-publisher] fetch posts: ${error.message}`);
  if (!posts || posts.length === 0) {
    logger(JSON.stringify({ event: "social_publish_none" }));
    return { published: 0, failed: 0, skipped: 0 };
  }

  // Per-platform remaining daily budget.
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

  // Resolve the static X credentials lazily on first publishable post.
  let creds = null;

  let published = 0, failed = 0, skipped = 0;

  for (const post of posts) {
    if (remaining[post.platform] <= 0) {
      skipped++;
      logger(JSON.stringify({ event: "social_publish_cap_reached", platform: post.platform, post_id: post.id }));
      continue;
    }

    // Instagram requires a media asset before publishing (#16).
    if (post.platform === "instagram" && !post.media_url) {
      skipped++;
      logger.warn(JSON.stringify({ event: "social_publish_skip_no_media", post_id: post.id }));
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

    if (!creds) {
      try {
        creds = getCreds(env);
      } catch (authErr) {
        // Can't authenticate — release the claim and stop; nothing will publish.
        await supabase.from("social_posts").update({ status: "APPROVED" }).eq("id", post.id);
        throw new Error(`[social-publisher] auth: ${authErr.message}`);
      }
    }

    try {
      const result = await publishers[post.platform](post, { creds });
      await supabase
        .from("social_posts")
        .update({
          status: "POSTED",
          platform_post_id: result.platformPostId,
          platform_response: result.rawResponse,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
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
