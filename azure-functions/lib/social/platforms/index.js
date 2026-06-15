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
