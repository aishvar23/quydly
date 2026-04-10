// Phase 3 — URL canonicalisation + SHA256 hashing
// Rules:
//   1. Force https
//   2. Lowercase hostname
//   3. Remove trailing slash from path
//   4. Strip tracking params: utm_*, ref, source, campaign, fbclid, gclid, mc_*
//   5. Sort remaining params alphabetically
//   6. Remove fragment
//   7. url_hash = SHA256(canonical_url)

import { createHash } from "crypto";

const STRIP_PARAMS = /^(utm_.*|ref|source|campaign|fbclid|gclid|mc_.*)$/i;

export function canonicalise(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase();

  // Remove trailing slash from path (but keep "/" for root)
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }

  // Strip tracking params
  for (const key of [...u.searchParams.keys()]) {
    if (STRIP_PARAMS.test(key)) {
      u.searchParams.delete(key);
    }
  }

  // Sort remaining params
  u.searchParams.sort();

  // Remove fragment
  u.hash = "";

  return u.toString();
}

export function hashUrl(canonicalUrl) {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}
