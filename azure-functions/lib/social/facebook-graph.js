// Facebook Page publishing via the Meta Graph API.
//
// The right auth for a SERVER-SIDE backend posting to a SINGLE app-owned Page:
// a long-lived Page (or System User) access token + the Page id, both static env
// vars — no per-user OAuth, no browser flow. Mirrors instagram-graph.js (same
// GRAPH_BASE / version handling / env-only creds); we deliberately do NOT use a
// social_platform_connections DB table.
//
// Credentials (env):
//   FACEBOOK_PAGE_ID       — target Page id (e.g. from GET /me/accounts)
//   META_PAGE_ACCESS_TOKEN — Page or System User token (System User = never
//                            expires; preferred). MUST carry pages_manage_posts
//                            for /photos to succeed.
//   META_GRAPH_VERSION     — pinned Graph API version, e.g. "v21.0"
//
// Post format (locked): a SINGLE square card IMAGE + caption — published via
//   POST /{pageId}/photos  with  url=<public https card image> + caption=<text>.
// This is NOT a text-only feed post and NOT a multi-image post. /photos with a
// remote `url` publishes the photo to the Page feed in one call (no separate
// container/publish step like Instagram), returning { id, post_id }.

import {
  graphUrl, graphPost as metaGraphPost, resolveMetaCreds, noopLogger,
} from "./meta-graph.js";

// Bind the shared form-encoded POST to the "Facebook" error prefix so thrown
// messages stay "Facebook Graph <status>: …" exactly as before.
const graphPost = (url, params, fetchImpl) => metaGraphPost(url, params, fetchImpl, "Facebook");

// Graph's documented hard limit for a /photos caption (≈ a post message). We
// never chop at this — it's purely a defensive WARN threshold (see publish()).
const FB_CAPTION_HARD_LIMIT = 63206;

// Resolve Facebook Graph creds from env. Throws (loudly) if any required piece
// is missing so the publisher can release its claim cleanly instead of FAILing
// the post.
export function credsFromEnv(env = process.env) {
  return resolveMetaCreds(env, {
    idVar: "FACEBOOK_PAGE_ID",
    idKey: "pageId",
    platform: "Facebook",
  });
}

// Publish a post to the Facebook Page as a single photo + caption.
//   post   : { post_text|text (caption), media_url|mediaUrl (public https image) }
//   _slides: ACCEPTED but ignored — the publisher passes slides to every publisher
//            uniformly; Facebook uses a single image, not a carousel.
//   dryRun : assemble + log the request but call NO Meta endpoint (returns a
//            synthetic id, prefixed DRYRUN-, so the publisher can be exercised
//            end-to-end without credentials or a live post).
// Returns { platformPostId, rawResponse }.
export async function publish(post, { creds, slides: _slides = null, fetchImpl = fetch, logger = noopLogger, dryRun = false } = {}) {
  if (!creds) throw new Error("Facebook publish: missing Graph creds");
  const message = String(post.post_text || post.text || "");
  const imageUrl = post.media_url || post.mediaUrl || null;

  // The locked format is /photos with a remote image URL — an image is REQUIRED
  // and must be public HTTPS (Graph rejects non-HTTPS).
  if (!imageUrl) throw new Error("Facebook publish: no image url (media_url required)");
  if (!/^https:\/\//i.test(imageUrl)) throw new Error(`Facebook publish: image url must be public HTTPS: ${imageUrl}`);

  // The generator's format() self-truncates to 900 chars for quality, but a
  // human-edited DB row can be longer. Graph's real /photos caption limit is far
  // higher (~63,206 chars), so we DO NOT silently chop an intentional edit here —
  // sending the human's text verbatim and letting Graph be the authority. We only
  // WARN if it exceeds that hard Graph ceiling (Graph would reject it anyway).
  if (message.length > FB_CAPTION_HARD_LIMIT) {
    logger.warn(JSON.stringify({
      event: "fb_caption_over_hard_limit",
      page_id: creds.pageId,
      caption_len: message.length,
      hard_limit: FB_CAPTION_HARD_LIMIT,
    }));
  }

  if (dryRun) {
    logger(JSON.stringify({
      event: "fb_publish_dry_run",
      mode: "photo",
      page_id: creds.pageId,
      graph_version: creds.graphVersion,
      caption_len: message.length,
      image_url: imageUrl,
    }));
    return { platformPostId: "DRYRUN-fb-photo", rawResponse: { dryRun: true, url: imageUrl, caption: message } };
  }

  const raw = await graphPost(
    graphUrl(creds, `${creds.pageId}/photos`),
    { url: imageUrl, caption: message, access_token: creds.accessToken },
    fetchImpl
  );

  // /photos returns { id: <photo-id>, post_id: <feed-story-id> }. Prefer post_id
  // so platform_post_id is the FEED post id (linkable as the Page story) when
  // present, falling back to the photo id otherwise. rawResponse retains BOTH,
  // so a future reader can recover the photo id from platform_response.
  const platformPostId = raw.post_id || raw.id;
  if (!platformPostId) {
    throw new Error(`Facebook Graph: no post id in response: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  logger(JSON.stringify({ event: "fb_published", mode: "photo", post_id: platformPostId }));
  return { platformPostId, rawResponse: raw };
}
