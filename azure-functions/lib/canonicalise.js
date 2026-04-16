// Copy of backend/utils/canonicalise.js — kept in sync manually.
// If backend/utils/canonicalise.js changes, update this file too (see CLAUDE.md).

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

  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new Error(`Unsupported protocol "${u.protocol}" in URL: ${rawUrl}`);
  }

  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase();

  if (u.port === "443" || u.port === "80") {
    u.port = "";
  }

  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }

  for (const key of [...u.searchParams.keys()]) {
    if (STRIP_PARAMS.test(key)) {
      u.searchParams.delete(key);
    }
  }

  u.searchParams.sort();
  u.hash = "";

  return u.toString();
}

export function hashUrl(canonicalUrl) {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}
