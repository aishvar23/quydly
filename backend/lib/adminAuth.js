// Shared admin-token check for the backend admin routes.
//
// Constant-time compare of a caller-supplied token against the ADMIN_TOKEN env.
// Both adminSocial.js (cookie + header) and adminGenerate.js (header only)
// build their own requireAdmin on top of this — the security-sensitive compare
// lives here once so a hardening fix can't drift between copies.

import { timingSafeEqual } from "crypto";

export function tokenMatches(provided) {
  const expected = process.env.ADMIN_TOKEN || "";
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
