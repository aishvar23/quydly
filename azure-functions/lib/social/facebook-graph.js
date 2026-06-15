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

const DEFAULT_GRAPH_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

// Resolve Facebook Graph creds from env. Throws (loudly) if any required piece
// is missing so the publisher can release its claim cleanly instead of FAILing
// the post.
export function credsFromEnv(env = process.env) {
  const pageId = env.FACEBOOK_PAGE_ID;
  const accessToken = env.META_PAGE_ACCESS_TOKEN;
  const graphVersion = env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  const missing = [];
  if (!pageId) missing.push("FACEBOOK_PAGE_ID");
  if (!accessToken) missing.push("META_PAGE_ACCESS_TOKEN");
  if (missing.length) throw new Error(`Facebook Graph creds missing: ${missing.join(", ")}`);
  return { pageId, accessToken, graphVersion };
}

function graphUrl(creds, path) {
  return `${GRAPH_BASE}/${creds.graphVersion}/${path}`;
}

// POST form-encoded params to a Graph edge, returning parsed JSON. Throws with
// Meta's error detail (code / subcode / message) on a non-2xx.
async function graphPost(url, params, fetchImpl) {
  const body = new URLSearchParams(params);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok || raw.error) {
    const e = raw.error || {};
    const parts = [];
    if (e.code != null) parts.push(`code=${e.code}`);
    if (e.error_subcode != null) parts.push(`subcode=${e.error_subcode}`);
    const detail = e.message || JSON.stringify(raw).slice(0, 300);
    const meta = parts.length ? ` (${parts.join(" ")})` : "";
    throw new Error(`Facebook Graph ${res.status}: ${detail}${meta}${e.error_user_msg ? ` — ${e.error_user_msg}` : ""}`);
  }
  return raw;
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

  const platformPostId = raw.post_id || raw.id;
  if (!platformPostId) {
    throw new Error(`Facebook Graph: no post id in response: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  logger(JSON.stringify({ event: "fb_published", mode: "photo", post_id: platformPostId }));
  return { platformPostId, rawResponse: raw };
}
