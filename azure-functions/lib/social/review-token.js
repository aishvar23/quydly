// Canonical signing/verification for review-action links — the SINGLE source of
// truth shared by the email signer (review-notify.js, on Azure Functions) and the
// verifier (api/social-review.js, on Vercel), so the two can't drift. Pure: imports
// only node:crypto, so the Vercel function can bundle it without pulling in the
// rest of the azure-functions library.
//
// Token = HMAC-SHA256 over "<postId>:<action>:<exp>" (exp = expiry epoch-ms). The
// expiry is INSIDE the signed payload so it can't be extended by editing the URL,
// and the link stops working after it — bounding the "link lives in an inbox
// forever" exposure.

import { createHmac, timingSafeEqual } from "node:crypto";

export function reviewTokenSig(postId, action, exp, secret) {
  return createHmac("sha256", secret).update(`${postId}:${action}:${exp}`).digest("hex");
}

// True only when the token matches AND has not expired. Constant-time compare;
// length-guarded so timingSafeEqual never throws on a mismatched-length token.
export function reviewTokenValid({ postId, action, exp, token, secret, now = Date.now() }) {
  if (!secret || !token) return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= now) return false; // malformed or expired
  const expected = Buffer.from(reviewTokenSig(postId, action, expMs, secret));
  const got = Buffer.from(String(token));
  return expected.length === got.length && timingSafeEqual(expected, got);
}
