// Per-story freshness decay (P2-6).
//
// Computes a `story_decay_at` timestamp the renderer uses to flip a story
// from "current news" to "archive". Different categories age at different
// rates — a sports result is stale within a week, a science paper holds
// for a quarter, a sentencing in a long-running case stays relevant for
// months.
//
// The decision lives here rather than at render time so:
//   - The synthesizer knows the published_at + category at the moment of
//     write — render time has to recompute every time.
//   - Editors querying for "still-fresh stories" get a single
//     index-friendly column to filter on (see migration_data_quality_p2).
//   - The renderer can surface a deterministic "ARCHIVE" posture chip
//     without re-deriving the rule.
//
// Pure function, no I/O. The caller is responsible for handing us a valid
// ISO-8601 published_at — typically the value the synthesizer just stamped
// onto the story row.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Per-category decay windows (days). Keep these conservative — a story
// that flips to ARCHIVE prematurely is a bigger trust violation than one
// that lingers a week past its peak. Values picked from editorial intuition
// across the 5-story batches; revisit when we have render-time signal.
const CATEGORY_DECAY_DAYS = Object.freeze({
  world:   45,   // geopolitics, ongoing conflicts — long context arcs
  tech:    60,   // product launches, regulatory moves — slow burn
  finance: 30,   // markets move fast; quarterly earnings cycle
  culture: 21,   // entertainment news cools quickly after release week
  science: 90,   // papers and findings hold for the news cycle
  ai:      30,   // fast-moving release/model cycle; align with finance
});

// Default applied when category is missing or unrecognised. Roughly
// midway between the fastest and slowest categories so we don't over-
// or under-shoot before we know which bucket the story belongs in.
export const DEFAULT_DECAY_DAYS = 30;

export const CATEGORY_DECAY_DAYS_FOR_TEST = CATEGORY_DECAY_DAYS;

/**
 * Compute the absolute timestamp at which the story flips to "archive".
 *
 * @param {string|null|undefined} categoryId - one of CATEGORIES from config/categories.js
 * @param {string|Date|null|undefined} publishedAt - story's published_at (ISO or Date)
 * @returns {string|null} ISO-8601 timestamp, or null if publishedAt is unparseable
 */
export function computeStoryDecayAt(categoryId, publishedAt) {
  if (publishedAt == null) return null;
  const baseMs = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(publishedAt);
  if (!Number.isFinite(baseMs)) return null;

  const days = decayDaysFor(categoryId);
  return new Date(baseMs + days * ONE_DAY_MS).toISOString();
}

/**
 * Resolve the decay window for a given category. Falls back to
 * DEFAULT_DECAY_DAYS for unknown / null inputs.
 *
 * @param {string|null|undefined} categoryId
 * @returns {number} decay days
 */
export function decayDaysFor(categoryId) {
  if (typeof categoryId !== "string") return DEFAULT_DECAY_DAYS;
  const days = CATEGORY_DECAY_DAYS[categoryId.toLowerCase()];
  return Number.isFinite(days) ? days : DEFAULT_DECAY_DAYS;
}
