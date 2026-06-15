// Shared Meta Graph API primitives, used by both instagram-graph.js and
// facebook-graph.js. The two platforms publish very differently (IG: async
// container → poll → media_publish, optionally a carousel; FB: a single
// /photos call), but they share the same HTTP plumbing against
// graph.facebook.com: base URL, pinned version, form-encoded POST, JSON GET,
// the Meta error-detail formatter, and an env-only credential resolver.
//
// Only the SHARED primitives live here. Platform-specific edges
// (createContainer / waitForContainer / media_publish for IG; /photos for FB)
// stay in their own modules.
//
// Credentials are env-only (no per-user OAuth, no social_platform_connections
// table): a long-lived Page (or System User) access token + the target object
// id, both static env vars.
//   <idVar>                — IG Business Account id / FB Page id
//   META_PAGE_ACCESS_TOKEN — Page or System User token (System User = never expires)
//   META_GRAPH_VERSION     — pinned Graph API version, e.g. "v21.0"

export const GRAPH_BASE = "https://graph.facebook.com";
export const DEFAULT_GRAPH_VERSION = "v21.0";

// Callable logger matching the Azure Functions `context.log` convention.
export const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

// Build a versioned Graph edge URL. `creds.graphVersion` is always set by
// resolveMetaCreds (defaults applied), so callers never pass it explicitly.
export function graphUrl(creds, path) {
  return `${GRAPH_BASE}/${creds.graphVersion}/${path}`;
}

// Format Meta's error detail from a parsed Graph error body. Surfaces the
// message plus code / subcode / error_user_msg when present. Shared so IG and
// FB raise identical-shaped errors.
function formatGraphError(raw) {
  const e = raw.error || {};
  const parts = [];
  if (e.code != null) parts.push(`code=${e.code}`);
  if (e.error_subcode != null) parts.push(`subcode=${e.error_subcode}`);
  const detail = e.message || JSON.stringify(raw).slice(0, 300);
  const meta = parts.length ? ` (${parts.join(" ")})` : "";
  return `${detail}${meta}${e.error_user_msg ? ` — ${e.error_user_msg}` : ""}`;
}

// POST form-encoded params to a Graph edge, returning parsed JSON. Throws with
// Meta's error detail (code / subcode / message / user_msg) on a non-2xx or an
// error body. `platform` prefixes the thrown error ("Instagram"/"Facebook").
export async function graphPost(url, params, fetchImpl = fetch, platform = "Meta") {
  const body = new URLSearchParams(params);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok || raw.error) {
    throw new Error(`${platform} Graph ${res.status}: ${formatGraphError(raw)}`);
  }
  return raw;
}

// GET a Graph edge, returning parsed JSON. Throws on the same conditions as
// graphPost (non-2xx or an error body). Used by IG's container status poll.
export async function graphGet(url, fetchImpl = fetch, platform = "Meta") {
  const res = await fetchImpl(url);
  const raw = await res.json().catch(() => ({}));
  if (!res.ok || raw.error) {
    throw new Error(`${platform} Graph ${res.status}: ${formatGraphError(raw)}`);
  }
  return raw;
}

// Resolve Meta Graph creds from env. Reads the object id from `idVar`, plus the
// shared META_PAGE_ACCESS_TOKEN + META_GRAPH_VERSION (defaulted). Throws (loudly)
// listing every missing var so the publisher can release its claim instead of
// silently no-op'ing. Returns { [idKey]: id, accessToken, graphVersion }.
export function resolveMetaCreds(env = process.env, { idVar, idKey, platform = "Meta" } = {}) {
  const id = env[idVar];
  const accessToken = env.META_PAGE_ACCESS_TOKEN;
  const graphVersion = env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  const missing = [];
  if (!id) missing.push(idVar);
  if (!accessToken) missing.push("META_PAGE_ACCESS_TOKEN");
  if (missing.length) throw new Error(`${platform} Graph creds missing: ${missing.join(", ")}`);
  return { [idKey]: id, accessToken, graphVersion };
}
