// Phase 3 — URL canonicalisation + SHA256 hashing
// Rules:
//   1. Restrict input to http/https only
//   2. Force https
//   3. Lowercase hostname
//   4. Remove default ports (:443 for https, :80 for http)
//   5. Remove trailing slash from path (keep "/" for root)
//   6. Strip tracking params: utm_*, ref, source, campaign, fbclid, gclid, mc_*
//   7. Sort remaining params alphabetically
//   8. Remove fragment
//   9. url_hash = SHA256(canonical_url)

import { createHash } from "crypto";

const STRIP_PARAMS = /^(utm_.*|ref|source|campaign|fbclid|gclid|mc_.*)$/i;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function canonicalise(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  // Reject non-http(s) protocols before any transformation
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new Error(`Unsupported protocol "${u.protocol}" in URL: ${rawUrl}`);
  }

  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase();

  // Remove default ports so equivalent URLs hash identically
  if (u.port === "443" || u.port === "80") {
    u.port = "";
  }

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
