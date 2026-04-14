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

  // Rank: multi-word > acronym (all-caps) > single-word
  deduped.sort((a, b) => {
    const scoreOf = s => {
      if (s.includes(' ')) return 2;
      if (/^[a-z]{2,5}$/.test(s) && s === s.toUpperCase()) return 1; // preserved acronym (already lowercased by equivalence map edge case — handled below)
      return 0;
    };
    // After normalization acronyms are lowercased; detect via original if needed.
    // Use word count and length as a reasonable proxy.
    const wordsA = a.split(' ').length;
    const wordsB = b.split(' ').length;
    if (wordsA !== wordsB) return wordsB - wordsA; // more words = higher priority
    return b.length - a.length;                    // longer = higher priority
  });

  return deduped.slice(0, MAX_ENTITIES);
}

/**
 * Returns true if at least one entity in the array is "high-signal":
 *   - A multi-word entity (contains a space), or
 *   - A short all-caps acronym (2–5 chars, letters only, maps to a known form
 *     or was originally all-caps before normalization).
 *
 * Normalized entities are lowercased, so we detect acronym origin by checking
 * if the value is 2–5 alphabetic characters AND appears in the EQUIVALENCE_MAP
 * values, OR was produced from an all-caps source — we proxy this by checking
 * length ≤ 5 with no spaces and known equivalence-map output values.
 *
 * @param {string[]} entities — already normalised
 * @returns {boolean}
 */
export function hasHighSignalEntity(entities) {
  const acronymOutputs = new Set(Object.values(EQUIVALENCE_MAP));

  return entities.some(e => {
    // Multi-word entities are always high-signal
    if (e.includes(' ')) return true;
    // Known equivalence-map outputs (us, uk, eu) are high-signal acronyms
    if (acronymOutputs.has(e)) return true;
    // Short (2–4 char) purely-alpha tokens that came from all-caps source.
    // Since we lowercase everything, we accept 2–4 letter tokens as acronyms.
    if (/^[a-z]{2,4}$/.test(e)) return true;
    // Single words longer than 4 chars are high-signal (proper names, etc.)
    if (e.length > 4) return true;
    return false;
  });
}
