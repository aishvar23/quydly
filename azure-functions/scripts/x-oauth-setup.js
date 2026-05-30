#!/usr/bin/env node
// One-time X OAuth 2.0 (PKCE) setup to obtain a user-context token for posting.
//
// Prereqs (you create these in the X developer portal):
//   - An OAuth 2.0 app with scopes: tweet.read tweet.write users.read offline.access
//   - A Redirect URI (e.g. http://localhost/callback) registered on the app
//   - Env: X_CLIENT_ID, X_REDIRECT_URI, and X_CLIENT_SECRET if it is a confidential client
//     (read from process.env or azure-functions/local.settings.json Values)
//
// Step 1 — get the authorization URL:
//   node scripts/x-oauth-setup.js
//     → open the printed URL, log in to the X account you want to post AS, click
//       Authorize. Your browser lands on the redirect URI with ?code=...&state=...
//       Copy the FULL redirected URL.
//
// Step 2 — exchange the code for tokens (use the verifier printed in step 1):
//   node scripts/x-oauth-setup.js exchange "<full redirect URL>" "<verifier>"
//     → prints ACCESS TOKEN + REFRESH TOKEN. Put X_REFRESH_TOKEN (and X_CLIENT_ID/
//       SECRET) in the function app settings; the publisher refreshes as needed.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import { generatePkce, buildAuthUrl, exchangeCode, DEFAULT_SCOPES } from "../lib/social/x-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
  Object.assign(process.env, settings.Values || {});
} catch { /* fall back to process.env */ }

const { X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI } = process.env;

function requireEnv() {
  if (!X_CLIENT_ID || !X_REDIRECT_URI) {
    console.error("Set X_CLIENT_ID and X_REDIRECT_URI (and X_CLIENT_SECRET if confidential).");
    process.exit(1);
  }
}

const [, , cmd, callbackUrl, verifier] = process.argv;

if (cmd === "exchange") {
  requireEnv();
  if (!callbackUrl || !verifier) {
    console.error('Usage: node scripts/x-oauth-setup.js exchange "<redirect URL>" "<verifier>"');
    process.exit(1);
  }
  const code = new URL(callbackUrl).searchParams.get("code");
  if (!code) { console.error("No ?code= found in the redirect URL."); process.exit(1); }

  const tokens = await exchangeCode({
    clientId: X_CLIENT_ID, clientSecret: X_CLIENT_SECRET, redirectUri: X_REDIRECT_URI, code, verifier,
  });
  console.log("\n=== X tokens (store securely; do not commit) ===");
  console.log("access_token  (expires in", tokens.expires_in, "s):\n", tokens.access_token);
  console.log("\nrefresh_token (put in X_REFRESH_TOKEN):\n", tokens.refresh_token);
  console.log("\nscope:", tokens.scope);
} else {
  requireEnv();
  const { verifier: v, challenge } = generatePkce();
  const state = randomBytes(12).toString("hex");
  const url = buildAuthUrl({
    clientId: X_CLIENT_ID, redirectUri: X_REDIRECT_URI, scopes: DEFAULT_SCOPES, state, challenge,
  });
  console.log("\n1) Open this URL, log in as the posting account, and Authorize:\n");
  console.log(url);
  console.log("\n2) Copy the FULL redirected URL, then run:\n");
  console.log(`   node scripts/x-oauth-setup.js exchange "<redirect URL>" "${v}"`);
  console.log("\n(verifier shown above — keep it for the exchange step)");
}
