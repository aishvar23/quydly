// Instagram publishing via the Meta Graph API (tracker L2 + L4 carousel).
//
// The right auth for a SERVER-SIDE backend posting to a SINGLE app-owned IG
// Business account: a long-lived Page (or System User) access token + the IG
// Business Account id, both static env vars — no per-user OAuth, no browser
// flow. Mirrors the env-only credential approach used for X (x-oauth1.js); we
// deliberately do NOT use the guide's social_platform_connections DB table.
//
// Credentials (env):
//   INSTAGRAM_BUSINESS_ACCOUNT_ID  — target IG user id (from GET /me/accounts)
//   META_PAGE_ACCESS_TOKEN         — Page or System User token (System User = never expires; preferred)
//   META_GRAPH_VERSION             — pinned Graph API version, e.g. "v21.0"
//
// Publish flow (https://developers.facebook.com/docs/instagram-api/guides/content-publishing):
//   single image : create container(image_url) → media_publish(creation_id)
//   carousel     : create child container(image_url, is_carousel_item) ×N
//                  → create carousel container(media_type=CAROUSEL, children)
//                  → media_publish(creation_id)
// Containers can take a moment to process; carousel/video containers MUST be
// polled (GET ?fields=status_code) until FINISHED before publishing.

import {
  graphUrl, graphPost as metaGraphPost, graphGet as metaGraphGet,
  resolveMetaCreds, noopLogger,
} from "./meta-graph.js";

// Carousels accept 2–10 items (Instagram limit). A 1-item set publishes as a
// single image instead.
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;

// Container processing poll settings (carousel/video are async).
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 2000;
// Reels are encoded server-side and take noticeably longer than image carousels,
// so the REELS container is polled far longer before giving up (~2 min).
const REELS_POLL_ATTEMPTS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bind the shared Graph helpers to the "Instagram" error prefix so thrown
// messages stay "Instagram Graph <status>: …" exactly as before.
const graphPost = (url, params, fetchImpl) => metaGraphPost(url, params, fetchImpl, "Instagram");
const graphGet = (url, fetchImpl) => metaGraphGet(url, fetchImpl, "Instagram");

// Resolve IG Graph creds from env. Throws (loudly) if any piece is missing so
// the publisher can release its claim instead of silently no-op'ing.
export function credsFromEnv(env = process.env) {
  return resolveMetaCreds(env, {
    idVar: "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    idKey: "igUserId",
    platform: "Instagram",
  });
}

// Create a media container. Returns its id. `extra` carries is_carousel_item /
// media_type / children / caption depending on the call.
export async function createContainer({ creds, imageUrl, videoUrl, caption, extra = {}, fetchImpl = fetch }) {
  const params = { access_token: creds.accessToken, ...extra };
  if (imageUrl) params.image_url = imageUrl;
  if (videoUrl) params.video_url = videoUrl;
  if (caption != null) params.caption = caption;
  const raw = await graphPost(graphUrl(creds, `${creds.igUserId}/media`), params, fetchImpl);
  if (!raw.id) throw new Error(`Instagram Graph: no container id in response: ${JSON.stringify(raw).slice(0, 200)}`);
  return raw.id;
}

// Poll a container until status_code === FINISHED. IN_PROGRESS keeps waiting;
// ERROR/EXPIRED throw. Returns when ready.
export async function waitForContainer({ creds, containerId, fetchImpl = fetch, sleepImpl = sleep, attempts = POLL_ATTEMPTS }) {
  const url = `${graphUrl(creds, containerId)}?fields=status_code,status&access_token=${encodeURIComponent(creds.accessToken)}`;
  for (let i = 0; i < attempts; i++) {
    const raw = await graphGet(url, fetchImpl);
    const code = raw.status_code;
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(`Instagram container ${containerId} status=${code}: ${raw.status || ""}`);
    }
    // PUBLISHED also means done (already consumed); treat as ready.
    if (code === "PUBLISHED") return;
    await sleepImpl(POLL_INTERVAL_MS);
  }
  throw new Error(`Instagram container ${containerId} not FINISHED after ${attempts} polls`);
}

// Publish a finished container. Returns the published media id.
export async function publishContainer({ creds, creationId, fetchImpl = fetch }) {
  const raw = await graphPost(
    graphUrl(creds, `${creds.igUserId}/media_publish`),
    { access_token: creds.accessToken, creation_id: creationId },
    fetchImpl
  );
  if (!raw.id) throw new Error(`Instagram Graph: no media id from publish: ${JSON.stringify(raw).slice(0, 200)}`);
  return raw.id;
}

// Publish a post to Instagram.
//   post   : { post_text (caption), media_url (single-image fallback) }
//   slides : ordered [{ url }] carousel descriptors (preferred when ≥2)
//   dryRun : assemble + log every request but call NO Meta endpoint (returns a
//            synthetic id, prefixed DRYRUN-, so the publisher can be exercised
//            end-to-end without credentials or a live post).
// Returns { platformPostId, rawResponse }.
export async function publish(post, { creds, slides = null, reelUrl = null, fetchImpl = fetch, sleepImpl = sleep, logger = noopLogger, dryRun = false } = {}) {
  if (!creds) throw new Error("Instagram publish: missing Graph creds");
  const caption = String(post.post_text || post.text || "");

  // Reel wins precedence: a video Reel publishes as a single REELS container
  // (no image carousel). The async container is polled longer than images.
  const reel = reelUrl || post.reel_url || post.reelUrl || null;
  if (reel) {
    if (!/^https:\/\//i.test(reel)) throw new Error(`Instagram publish: reel url must be public HTTPS: ${reel}`);
    if (dryRun) {
      logger(JSON.stringify({ event: "ig_publish_dry_run", mode: "reel", caption_len: caption.length, ig_user_id: creds.igUserId, graph_version: creds.graphVersion, reel_url: reel }));
      return { platformPostId: "DRYRUN-reel", rawResponse: { dryRun: true, reelUrl: reel } };
    }
    const creationId = await createContainer({ creds, videoUrl: reel, caption, extra: { media_type: "REELS", share_to_feed: "true" }, fetchImpl });
    await waitForContainer({ creds, containerId: creationId, fetchImpl, sleepImpl, attempts: REELS_POLL_ATTEMPTS });
    const mediaId = await publishContainer({ creds, creationId, fetchImpl });
    logger(JSON.stringify({ event: "ig_published", mode: "reel", media_id: mediaId }));
    return { platformPostId: mediaId, rawResponse: { creation_id: creationId, media_id: mediaId, mode: "reel" } };
  }

  // Build the ordered list of public image URLs.
  const slideUrls = (slides || [])
    .map((s) => (typeof s === "string" ? s : s && s.url))
    .filter(Boolean);
  const singleUrl = post.media_url || post.mediaUrl || null;
  const urls = slideUrls.length ? slideUrls : (singleUrl ? [singleUrl] : []);

  if (urls.length === 0) throw new Error("Instagram publish: no image url(s)");
  for (const u of urls) {
    if (!/^https:\/\//i.test(u)) throw new Error(`Instagram publish: image url must be public HTTPS: ${u}`);
  }

  const isCarousel = urls.length >= CAROUSEL_MIN;
  if (urls.length > CAROUSEL_MAX) throw new Error(`Instagram publish: ${urls.length} slides exceeds carousel max ${CAROUSEL_MAX}`);

  if (dryRun) {
    logger(JSON.stringify({
      event: "ig_publish_dry_run",
      mode: isCarousel ? "carousel" : "single",
      slides: urls.length,
      caption_len: caption.length,
      ig_user_id: creds.igUserId,
      graph_version: creds.graphVersion,
      urls,
    }));
    return { platformPostId: `DRYRUN-${urls.length}-${isCarousel ? "carousel" : "single"}`, rawResponse: { dryRun: true, urls } };
  }

  let creationId;
  if (isCarousel) {
    // 1. A child container per slide.
    const childIds = [];
    for (const url of urls) {
      const id = await createContainer({ creds, imageUrl: url, extra: { is_carousel_item: "true" }, fetchImpl });
      childIds.push(id);
    }
    // 2. The carousel parent (caption lives here).
    creationId = await createContainer({
      creds, caption, extra: { media_type: "CAROUSEL", children: childIds.join(",") }, fetchImpl,
    });
  } else {
    // Single image (caption on the container itself).
    creationId = await createContainer({ creds, imageUrl: urls[0], caption, fetchImpl });
  }

  // 3. Wait for processing, then publish.
  await waitForContainer({ creds, containerId: creationId, fetchImpl, sleepImpl });
  const mediaId = await publishContainer({ creds, creationId, fetchImpl });

  logger(JSON.stringify({ event: "ig_published", mode: isCarousel ? "carousel" : "single", slides: urls.length, media_id: mediaId }));
  return { platformPostId: mediaId, rawResponse: { creation_id: creationId, media_id: mediaId } };
}

// Post a comment on an IG media (the engagement "answer" comment, ~12h after
// publish). Requires the Page/System-User token to carry `instagram_manage_comments`.
//   creds   : { igUserId, accessToken, graphVersion } (credsFromEnv)
//   mediaId : the published IG media id (social_post_engagement.ig_media_id)
//   message : the comment text
//   dryRun  : assemble + log the request but call NO Meta endpoint (synthetic id)
// Returns { commentId, rawResponse }. Throws "Instagram Graph <status>: …" on a
// Graph error (e.g. 400 / code=190 expired-or-unscoped token, 100 invalid media).
export async function postComment({ creds, mediaId, message, fetchImpl = fetch, logger = noopLogger, dryRun = false } = {}) {
  if (!creds) throw new Error("Instagram postComment: missing Graph creds");
  if (!mediaId) throw new Error("Instagram postComment: missing mediaId");
  const text = String(message || "");
  if (!text.trim()) throw new Error("Instagram postComment: empty message");

  if (dryRun) {
    logger(JSON.stringify({ event: "ig_comment_dry_run", media_id: mediaId, message_len: text.length, graph_version: creds.graphVersion }));
    return { commentId: `DRYRUN-COMMENT-${mediaId}`, rawResponse: { dryRun: true, mediaId, message: text } };
  }

  const raw = await graphPost(
    graphUrl(creds, `${mediaId}/comments`),
    { access_token: creds.accessToken, message: text },
    fetchImpl
  );
  if (!raw.id) throw new Error(`Instagram Graph: no comment id in response: ${JSON.stringify(raw).slice(0, 200)}`);
  logger(JSON.stringify({ event: "ig_comment_posted", media_id: mediaId, comment_id: raw.id }));
  return { commentId: raw.id, rawResponse: raw };
}

// List the comments already on an IG media. Used by the comment-publisher's
// idempotency check on retries: if a prior attempt actually posted the comment
// but lost the response, this surfaces it so we mark POSTED instead of double-
// posting. Returns [{ id, text }] (empty array when the media has no comments).
//   creds   : { igUserId, accessToken, graphVersion } (credsFromEnv)
//   mediaId : the published IG media id (social_post_engagement.ig_media_id)
// Throws "Instagram Graph <status>: …" on a Graph error.
export async function listComments({ creds, mediaId, fetchImpl = fetch, logger = noopLogger } = {}) {
  if (!creds) throw new Error("Instagram listComments: missing Graph creds");
  if (!mediaId) throw new Error("Instagram listComments: missing mediaId");
  const url = `${graphUrl(creds, `${mediaId}/comments`)}?fields=id,text&access_token=${encodeURIComponent(creds.accessToken)}`;
  const raw = await graphGet(url, fetchImpl);
  const data = Array.isArray(raw.data) ? raw.data : [];
  logger(JSON.stringify({ event: "ig_comments_listed", media_id: mediaId, count: data.length }));
  return data.map((c) => ({ id: c.id, text: c.text }));
}
