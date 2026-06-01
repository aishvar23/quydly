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
import { credsFromEnv as xCredsFromEnv } from "./x-oauth1.js";
import { publish as igPublish, credsFromEnv as igCredsFromEnv } from "./instagram-graph.js";

const BATCH = 20;
const DEFAULT_PUBLISHERS = { x: xPublish, instagram: igPublish };
// Per-platform credential resolvers (env → creds). Each is called at most once,
// lazily, the first time a post for that platform is published.
const DEFAULT_CREDS_RESOLVERS = { x: xCredsFromEnv, instagram: igCredsFromEnv };

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
  // X creds resolver (kept named `getCreds` for back-compat); IG uses getIgCreds.
  getCreds = xCredsFromEnv,
  getIgCreds = igCredsFromEnv,
  env = process.env,
  logger = noopLogger,
  now = new Date(),
} = {}) {
  const enabledPlatforms = Object.keys(publishers);

  // Lazy, per-platform credential resolution. A platform whose creds are
  // unavailable (not configured) has its posts released + skipped — it does not
  // block other platforms (e.g. missing IG creds must not stop X publishing).
  const credsResolvers = { ...DEFAULT_CREDS_RESOLVERS, x: getCreds, instagram: getIgCreds };
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
