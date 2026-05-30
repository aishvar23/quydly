// X (Twitter) OAuth 1.0a User Context request signing.
//
// The right auth for a SERVER-SIDE backend posting to a SINGLE app-owned account:
// four static, non-expiring credentials generated once in the X developer portal
//   - X_API_KEY            (consumer key)
//   - X_API_SECRET         (consumer secret)
//   - X_ACCESS_TOKEN       (the app owner's access token)
//   - X_ACCESS_TOKEN_SECRET
// No browser bootstrap, no token refresh. Posting requires the app's User auth
// settings to grant Read+Write, with the Access Token generated after that.
//
// Reference: X docs → Authentication → OAuth 1.0a → Authorizing a request /
// Creating a signature. Verified against X's canonical example in the unit test.

import { createHmac, randomBytes } from "crypto";

// RFC 3986 percent-encoding (encodeURIComponent + the four extra chars).
export function percentEncode(str) {
  return encodeURIComponent(String(str)).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

// The OAuth 1.0a signature base string. `params` = any query/form params to
// include (NOT JSON bodies — those are not signed). `oauth` = the oauth_* params
// (without oauth_signature). This is the percent-encoding/sorting-sensitive part.
export function signatureBaseString({ method, baseUrl, params, oauth }) {
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [percentEncode(k), percentEncode(all[k])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return [method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramString)].join("&");
}

// HMAC-SHA1 signature (base64) over the base string.
export function buildSignature({ method, baseUrl, params, oauth, consumerSecret, tokenSecret }) {
  const base = signatureBaseString({ method, baseUrl, params, oauth });
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(base).digest("base64");
}

// Build the full `Authorization: OAuth ...` header value for a request.
//   creds = { consumerKey, consumerSecret, token, tokenSecret }
//   params = query/form params to include in the signature (default none — for
//            JSON-body endpoints like POST /2/tweets, leave empty).
//   nonce / timestamp are injectable for deterministic testing.
export function buildAuthHeader({ method, url, params = {}, creds, nonce, timestamp }) {
  const baseUrl = url.split("?")[0];
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce || randomBytes(24).toString("base64").replace(/[^a-zA-Z0-9]/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };

  const oauth_signature = buildSignature({
    method,
    baseUrl,
    params,
    oauth,
    consumerSecret: creds.consumerSecret,
    tokenSecret: creds.tokenSecret,
  });

  const headerParams = { ...oauth, oauth_signature };
  const header =
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
      .join(", ");
  return header;
}

// Resolve the four credentials from env (X_API_KEY/SECRET, X_ACCESS_TOKEN/SECRET).
export function credsFromEnv(env = process.env) {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    throw new Error("X auth: set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET");
  }
  return {
    consumerKey: X_API_KEY,
    consumerSecret: X_API_SECRET,
    token: X_ACCESS_TOKEN,
    tokenSecret: X_ACCESS_TOKEN_SECRET,
  };
}
