// Phase 2 — NLP Utilities
// Entity extraction and normalization for the Gold Set clustering pipeline.
// No external NLP libraries — regex only.

const EQUIVALENCE_MAP = {
  'u.s.':           'us',
  'united states':  'us',
  'u.k.':           'uk',
  'united kingdom': 'uk',
  'eu':             'eu',
  'european union': 'eu',
};

/**
 * Normalise a single entity string.
 * Lowercases, trims, then applies the equivalence map.
 * @param {string} entity
 * @returns {string}
 */
export function normalizeEntity(entity) {
  const lower = entity.trim().toLowerCase();
  return EQUIVALENCE_MAP[lower] ?? lower;
}

/**
 * Extract named entities from a text string (title + summary).
 * Pattern: one or more Title-Case words (up to 4 words per entity).
 * Returns a deduplicated, normalised array.
 * @param {string} text
 * @returns {string[]}
 */
export function extractEntities(text) {
  if (!text || typeof text !== 'string') return [];

  const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
  const seen = new Set();
  const entities = [];

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const normalised = normalizeEntity(match[1]);
    if (!seen.has(normalised)) {
      seen.add(normalised);
      entities.push(normalised);
    }
  }

  return entities;
}

/**
 * Returns true if at least one entity in the array has length > 3
 * after normalisation (i.e. is a "high-signal" entity).
 * @param {string[]} entities — already normalised
 * @returns {boolean}
 */
export function hasHighSignalEntity(entities) {
  return entities.some(e => e.length > 3);
}
