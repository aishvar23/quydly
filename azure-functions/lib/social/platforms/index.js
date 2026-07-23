// Single source of truth for the set of caption platforms and their CONSTRAINTS.
//
// The generator iterates PLATFORM_MODULES to produce one draft per platform; the
// publisher (which dispatches by the DB `post.platform` string) looks up
// CONSTRAINTS by platform name via PLATFORM_REGISTRY. Both derive "does this
// platform require media before publish" from CONSTRAINTS.requiresMedia — there
// is no hand-maintained list of media-gated platforms anywhere.

import * as x from "./x.js";
import * as facebook from "./facebook.js";
import * as instagram from "./instagram.js";

// Ordered list of platform modules (generation order).
export const PLATFORM_MODULES = [x, facebook, instagram];

// name (PLATFORM constant) → module, for dispatch-by-string callers.
export const PLATFORM_REGISTRY = Object.fromEntries(
  PLATFORM_MODULES.map((p) => [p.PLATFORM, p])
);

// Does a platform require a media asset (media_url) before publishing?
// Derived from CONSTRAINTS.requiresMedia — the single source of truth.
export function requiresMedia(platformName) {
  return PLATFORM_REGISTRY[platformName]?.CONSTRAINTS?.requiresMedia === true;
}

// Per-platform kill switch: SOCIAL_<PLATFORM>_ENABLED (platform name uppercased,
// e.g. SOCIAL_X_ENABLED, SOCIAL_INSTAGRAM_ENABLED, SOCIAL_FACEBOOK_ENABLED).
// Default ON — set the App Setting to "false" (or "0") in Azure to turn one
// platform fully off without a redeploy. Honoured by BOTH the generator (no
// drafts are created, so nothing piles up APPROVED behind the gate) and the
// publisher (nothing is fetched/claimed/published, including the admin
// publish-now path, which only flips status and still publishes here).
// Candidates are shared across platforms, so disabling one platform never
// affects the others' supply. Re-enable by deleting the setting or setting it
// to "true".
export function platformEnabled(env, platformName) {
  const v = (env || {})[`SOCIAL_${String(platformName).toUpperCase()}_ENABLED`];
  return !/^(0|false)$/i.test(String(v ?? "true"));
}
