// Phase 2 — NLP Utilities
// Entity extraction and normalization for the Gold Set clustering pipeline.
// No external NLP libraries — regex only.

const EQUIVALENCE_MAP = {
  'u.s.':           'us',
  'u.s':            'us',   // after trailing-dot strip
  'united states':  'us',
  'u.k.':           'uk',
  'u.k':            'uk',   // after trailing-dot strip
  'united kingdom': 'uk',
  'eu':             'eu',
  'european union': 'eu',
};

// Single-word entities that are definitively high-signal.
// All values are post-normalization (lowercased).
// Do NOT use string length as a proxy — add explicit entries here instead.
const HIGH_SIGNAL_SINGLES = new Set([
  // Equivalence-map canonical outputs
  'us', 'uk', 'eu',
  // Intergovernmental / multilateral
  'un', 'nato', 'who', 'imf', 'wto', 'g7', 'g20', 'icc', 'iaea',
  // US government agencies / bodies
  'fbi', 'cia', 'nsa', 'doj', 'dhs', 'sec', 'fed', 'gop',
  // Common news acronyms
  'ai', 'ceo', 'cfo',
]);

// Low-signal entities to discard after normalization.
const STOP_ENTITIES = new Set([
  // Weekdays
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // Generic publishing / news words
  'breaking', 'news', 'update', 'report', 'latest', 'exclusive', 'live',
  'watch', 'read', 'just', 'new', 'top', 'more', 'full', 'first',
]);

const MAX_ENTITIES = 10;

/**
 * Clean a raw entity string before normalization:
 *   - Strip leading/trailing punctuation
 *   - Remove a leading article (The, A, An)
 *   - Normalize internal whitespace
 *   - Trim
 * @param {string} entity
 * @returns {string}
 */
function cleanEntity(entity) {
  let s = entity;
  // Strip leading/trailing punctuation (commas, periods, quotes, colons, etc.)
  s = s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  // Remove leading article (also handles standalone "The", "A", "An")
  s = s.replace(/^(The|An?)(\s+|$)/i, '');
  // Normalize internal whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Normalise a single entity string.
 * Cleans, lowercases, then applies the equivalence map.
 * @param {string} entity
 * @returns {string}
 */
export function normalizeEntity(entity) {
  const cleaned = cleanEntity(entity);
  const lower = cleaned.toLowerCase();
  return EQUIVALENCE_MAP[lower] ?? lower;
}

/**
 * Extract named entities from a text string (title + summary).
 *
 * Two extraction passes:
 *   1. Title-case phrases — one to four consecutive Title-Case words
 *   2. All-caps acronyms — two to five uppercase letters, optionally dot-separated
 *
 * After extraction:
 *   - Entities are cleaned and normalized
 *   - Stop-entities are removed
 *   - Shorter entities that are strict substrings of longer retained ones are dropped
 *   - Results are ranked: multi-word first, then acronyms, then single-word
 *   - Capped at MAX_ENTITIES
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractEntities(text) {
  if (!text || typeof text !== 'string') return [];

  const titleCasePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
  // Two patterns: plain all-caps (WHO, NATO, AI) and dot-separated (U.S., U.K.)
  // The dot-separated variant avoids a trailing \b since the string ends with '.'
  const acronymPattern = /\b([A-Z]{2,5})\b|((?:[A-Z]\.){2,}[A-Z]?)/g;

  const rawMatches = [];

  let m;
  while ((m = titleCasePattern.exec(text)) !== null) rawMatches.push(m[1]);
  // m[1] = plain all-caps, m[2] = dot-separated acronym (U.S., U.K.)
  while ((m = acronymPattern.exec(text)) !== null)   rawMatches.push(m[1] ?? m[2]);

  // Normalize and deduplicate
  const seen = new Set();
  const unique = [];
  for (const raw of rawMatches) {
    const normed = normalizeEntity(raw);
    if (!normed || seen.has(normed) || STOP_ENTITIES.has(normed)) continue;
    seen.add(normed);
    unique.push(normed);
  }

  // Remove shorter entities that are strict substrings of longer retained ones
  const deduped = unique.filter((e, _, arr) =>
    !arr.some(other => other !== e && other.includes(e))
  );

  // Rank by word count descending, then by character length descending.
  // All entities are lowercased after normalization so no acronym-specific
  // ordering is possible here — HIGH_SIGNAL_SINGLES handles acronym identity.
  deduped.sort((a, b) => {
    const wordsA = a.split(' ').length;
    const wordsB = b.split(' ').length;
    if (wordsA !== wordsB) return wordsB - wordsA;
    return b.length - a.length;
  });

  return deduped.slice(0, MAX_ENTITIES);
}

/**
 * Returns true if at least one entity in the array is high-signal.
 *
 * Two rules, nothing else:
 *   1. Multi-word entity (contains a space) — e.g. "donald trump", "federal reserve"
 *   2. Explicit membership in HIGH_SIGNAL_SINGLES — e.g. "nato", "fbi", "us"
 *
 * Length is NOT used as a proxy. After normalization all entities are lowercased,
 * so case-based acronym detection is impossible; instead, add known acronyms to
 * HIGH_SIGNAL_SINGLES explicitly.
 *
 * @param {string[]} entities — already normalised
 * @returns {boolean}
 */
export function hasHighSignalEntity(entities) {
  return entities.some(e => e.includes(' ') || HIGH_SIGNAL_SINGLES.has(e));
}
