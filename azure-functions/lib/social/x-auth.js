// X (Twitter) OAuth 2.0 Authorization Code + PKCE helpers.
//
// User-context auth for posting tweets (scope: tweet.read tweet.write users.read).
// The interactive authorization (browser login + consent) is performed by a human
// via scripts/x-oauth-setup.js; this module provides the pure building blocks plus
// token refresh used by the publisher at runtime.
//
// Endpoints (X API v2):
//   authorize: https://x.com/i/oauth2/authorize
//   token:     https://api.x.com/2/oauth2/token

import { createHash, randomBytes } from "crypto";

export const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const DEFAULT_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// PKCE pair. verifier is the secret; challenge (S256) goes in the auth URL.
export function generatePkce() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl({ clientId, redirectUri, scopes = DEFAULT_SCOPES, state, challenge }) {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// Confidential clients authenticate the token request with HTTP Basic; public
// clients send client_id in the body. We send both safely: Basic when a secret
// is present, client_id always in the body.
function tokenHeaders(clientId, clientSecret) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (clientSecret) {
    headers.Authorization = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  }
  return headers;
}

async function postToken(body, { clientId, clientSecret, fetchImpl = fetch }) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: tokenHeaders(clientId, clientSecret),
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.error_description || json.error || JSON.stringify(json).slice(0, 300);
    throw new Error(`X token endpoint ${res.status}: ${detail}`);
  }
  return json; // { access_token, refresh_token, expires_in, scope, token_type }
}

export function exchangeCode({ clientId, clientSecret, redirectUri, code, verifier, fetchImpl }) {
  return postToken(
    { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId },
    { clientId, clientSecret, fetchImpl }
  );
}

export function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchImpl }) {
  return postToken(
    { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId },
    { clientId, clientSecret, fetchImpl }
  );
}

// Resolve a usable access token for the publisher.
//  - X_ACCESS_TOKEN set        → use directly (short-lived; fine for a test post)
//  - else X_REFRESH_TOKEN set  → refresh via client creds and return a fresh token
// Returns { accessToken, refreshToken? } or throws if nothing is configured.
export async function getAccessToken({ env = process.env, fetchImpl } = {}) {
  if (env.X_ACCESS_TOKEN) return { accessToken: env.X_ACCESS_TOKEN };

  if (env.X_REFRESH_TOKEN && env.X_CLIENT_ID) {
    const tok = await refreshAccessToken({
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      refreshToken: env.X_REFRESH_TOKEN,
      fetchImpl,
    });
    return { accessToken: tok.access_token, refreshToken: tok.refresh_token };
  }

  throw new Error("X auth: set X_ACCESS_TOKEN, or X_CLIENT_ID + X_REFRESH_TOKEN");
}
