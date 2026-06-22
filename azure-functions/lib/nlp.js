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

// Geographic regions broad enough that sharing them between two articles does
// not imply they cover the same story. Used by the clusterer to reject
// "high-signal" matches that are actually just region overlap (e.g. "West Asia"
// shared between an LPG-supply story and a sailor's death). Entries must be in
// post-normalisation form — e.g. "eu" not "european union", since
// EQUIVALENCE_MAP collapses the latter to the former before clustering.
const BROAD_ENTITIES = new Set([
  'us', 'uk', 'eu',
  'west asia', 'east asia', 'south asia', 'southeast asia', 'central asia',
  'middle east', 'far east', 'near east',
  'north america', 'latin america', 'central america', 'south america',
  'sub saharan africa', 'north africa', 'west africa', 'east africa',
  'eastern europe', 'western europe', 'central europe', 'northern europe',
  'gulf war', 'cold war', 'world war',
]);

const STOP_ENTITIES = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'breaking', 'news', 'update', 'report', 'latest', 'exclusive', 'live',
  'watch', 'read', 'just', 'new', 'top', 'more', 'full', 'first',
]);

const MAX_ENTITIES = 10;

// Leading honorific / office titles that attach to a person's name in headlines
// ("Prime Minister Keir Starmer", "President Macron"). The title-case extractor
// greedily captures the title as part of the name, so the SAME person surfaces
// as two different tokens across articles ("prime minister keir starmer" in one,
// "keir starmer" in another) — splitting one event into multiple clusters and
// defeating the River entity-overlap merge (the 3-way "Starmer resigns" dup).
// Stripping the title leaves the residual proper name, which matches everywhere.
//
// Curated to CLEARLY-PERSONAL titles only. Role words that also begin
// organisation names are deliberately EXCLUDED — "General" (General Motors),
// "Justice" (Justice Department), "Captain"/"King"/"Prince"/"Queen" — because
// stripping them would corrupt org entities. Multi-word titles are listed first
// so the alternation prefers the longest match. The strip only fires when a name
// remains after it (guarded in cleanEntity) so a bare "Prime Minister" survives.
const TITLE_PREFIX_RE =
  /^(?:deputy prime minister|prime minister|vice president|chief minister|chief justice|foreign secretary|home secretary|defen[cs]e secretary|finance minister|president|chancellor|ambassador|reverend|professor|ayatollah|senator|governor|premier|doctor|sultan|sheikh|mayor|pope|prof|rev|dame|dr|sir|pm|vp)\s+/i;

function cleanEntity(entity) {
  let s = entity;
  s = s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  s = s.replace(/^(The|An?)(\s+|$)/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  // Strip a leading personal title ONLY if a proper name remains after it —
  // never strip "Prime Minister" (no name) down to an empty token.
  const detitled = s.replace(TITLE_PREFIX_RE, '').trim();
  if (detitled) s = detitled;
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

// Stricter variant used by the clusterer when deciding whether two articles
// belong to the same cluster. Excludes broad regions so that overlap on
// "west asia" alone is no longer enough to anchor a match.
export function hasSpecificHighSignalEntity(entities) {
  return entities.some(
    e => (e.includes(' ') || HIGH_SIGNAL_SINGLES.has(e)) && !BROAD_ENTITIES.has(e),
  );
}

// Strictest anchor — requires a genuinely STORY-specific named entity, not just
// a category/geo/org boilerplate token. Used by the clusterer on the relaxed
// (2-entity) merge path so that `ai` articles sharing only generic tokens like
// "ai" + "ceo" do NOT merge: at the lower threshold, generic high-signal singles
// (HIGH_SIGNAL_SINGLES: ai, ceo, us, nato, ...) are category-wide noise, so an
// anchor must be a multi-word proper name (e.g. "Sam Altman") or a non-generic
// single (e.g. "openai", "gpt", "nvidia"). Broad regions are excluded as before.
export function isSpecificNamedEntity(e) {
  return !BROAD_ENTITIES.has(e) && (e.includes(' ') || !HIGH_SIGNAL_SINGLES.has(e));
}

export function hasSpecificNamedEntity(entities) {
  return entities.some(isSpecificNamedEntity);
}
