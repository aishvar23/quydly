const EQUIVALENCE_MAP = {
  'u.s.':           'us',
  'u.s':            'us',
  'united states':  'us',
  'u.k.':           'uk',
  'u.k':            'uk',
  'united kingdom': 'uk',
  'eu':             'eu',
  'european union': 'eu',
};

const HIGH_SIGNAL_SINGLES = new Set([
  'us', 'uk', 'eu',
  'un', 'nato', 'who', 'imf', 'wto', 'g7', 'g20', 'icc', 'iaea',
  'fbi', 'cia', 'nsa', 'doj', 'dhs', 'sec', 'fed', 'gop',
  'ai', 'ceo', 'cfo',
]);

const STOP_ENTITIES = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'breaking', 'news', 'update', 'report', 'latest', 'exclusive', 'live',
  'watch', 'read', 'just', 'new', 'top', 'more', 'full', 'first',
]);

const MAX_ENTITIES = 10;

function cleanEntity(entity) {
  let s = entity;
  s = s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  s = s.replace(/^(The|An?)(\s+|$)/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function normalizeEntity(entity) {
  const cleaned = cleanEntity(entity);
  const lower = cleaned.toLowerCase();
  return EQUIVALENCE_MAP[lower] ?? lower;
}

export function extractEntities(text) {
  if (!text || typeof text !== 'string') return [];

  const titleCasePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
  const acronymPattern = /\b([A-Z]{2,5})\b|((?:[A-Z]\.){2,}[A-Z]?)/g;

  const rawMatches = [];

  let m;
  while ((m = titleCasePattern.exec(text)) !== null) rawMatches.push(m[1]);
  while ((m = acronymPattern.exec(text)) !== null)   rawMatches.push(m[1] ?? m[2]);

  const seen = new Set();
  const unique = [];
  for (const raw of rawMatches) {
    const normed = normalizeEntity(raw);
    if (!normed || seen.has(normed) || STOP_ENTITIES.has(normed)) continue;
    seen.add(normed);
    unique.push(normed);
  }

  const deduped = unique.filter((e, _, arr) =>
    !arr.some(other => other !== e && other.includes(e))
  );

  deduped.sort((a, b) => {
    const wordsA = a.split(' ').length;
    const wordsB = b.split(' ').length;
    if (wordsA !== wordsB) return wordsB - wordsA;
    return b.length - a.length;
  });

  return deduped.slice(0, MAX_ENTITIES);
}

export function hasHighSignalEntity(entities) {
  return entities.some(e => e.includes(' ') || HIGH_SIGNAL_SINGLES.has(e));
}
