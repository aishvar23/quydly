// Geo gazetteer — hand-curated country/region alias lookup + scoring helpers.
//
// No NLP dependency. Matches the `nlp.js` regex-only philosophy:
// multi-word aliases are matched before single-word ones, case-insensitive,
// word-boundary anchored. Start minimal; extend as gaps surface (see design
// §10.1).
//
// Exports referenced elsewhere in the pipeline:
//   - AUDIENCES                    scraper/clusterer/synthesizer iterate this
//   - GEO_ALIASES                  scraper mention extraction
//   - REGIONS                      reverse lookup (country → region)
//   - extractMentionedGeos         scraper
//   - mentionStrength              scraper (per-audience score composition)
//   - computeArticleAudienceScore  scraper (raw_articles.geo_scores)
//   - computePrimaryGeos           clusterer (clusters.primary_geos)
//   - computeClusterGeoScores      clusterer (clusters.geo_scores)
//   - computeAudienceProjection    synthesizer (story_audiences row payload)

// ── Audiences ────────────────────────────────────────────────────────────────
// Fixed list. Adding an entry here obligates scraper/clusterer/synthesizer to
// compute a per-audience score slot. Keep short.
export const AUDIENCES = ["india", "global"];

// ── Country code → aliases (ISO 3166-1 alpha-2, lowercase) ───────────────────
// Aliases are lowercase; matched against lowercased text with word boundaries.
// Curated, not exhaustive. Missed entities fall through to empty mentioned_geos.
export const GEO_ALIASES = {
  in: {
    region: "south_asia",
    aliases: [
      "india", "indian", "indians",
      "new delhi", "mumbai", "delhi", "bombay", "bangalore", "bengaluru",
      "chennai", "madras", "kolkata", "calcutta", "hyderabad", "pune",
      "ahmedabad", "jaipur", "lucknow", "kanpur", "nagpur", "surat",
      "kerala", "tamil nadu", "karnataka", "maharashtra", "uttar pradesh",
      "west bengal", "gujarat", "rajasthan", "punjab", "haryana", "bihar",
      "odisha", "telangana", "andhra pradesh", "madhya pradesh",
      "bjp", "congress party", "aam aadmi party", "modi", "narendra modi",
      "rahul gandhi", "rbi", "reserve bank of india",
      "rupee", "sensex", "nifty", "bse", "nse",
    ],
  },
  pk: {
    region: "south_asia",
    aliases: [
      "pakistan", "pakistani", "pakistanis",
      "islamabad", "karachi", "lahore", "rawalpindi", "peshawar", "quetta",
      "punjab province", "sindh", "balochistan", "khyber pakhtunkhwa",
      "imran khan", "shehbaz sharif", "pti", "pml-n",
    ],
  },
  bd: {
    region: "south_asia",
    aliases: [
      "bangladesh", "bangladeshi", "bangladeshis",
      "dhaka", "chittagong", "chattogram",
      "awami league", "bnp", "sheikh hasina",
    ],
  },
  lk: {
    region: "south_asia",
    aliases: [
      "sri lanka", "sri lankan", "sri lankans",
      "colombo", "kandy", "jaffna",
    ],
  },
  np: {
    region: "south_asia",
    aliases: [
      "nepal", "nepali", "nepalese",
      "kathmandu", "pokhara",
    ],
  },

  // P3-1 — non-SA expansion. Without these, story 170 (Iran/Hormuz) had
  // mentioned_geos = []; primary_geos collapsed to ["in"] from publisher
  // aggregation alone. Coverage is still curated, not exhaustive — extend
  // when a real-story audit surfaces the next gap.
  us: {
    region: "north_america",
    aliases: [
      "united states", "u.s.", "u.s.a.", "usa", "america", "american", "americans",
      "washington", "white house", "pentagon", "state department", "doj",
      "department of justice", "department of defense", "treasury department",
      "new york", "los angeles", "chicago", "houston", "miami", "boston",
      "san francisco", "seattle", "manhattan", "brooklyn",
      "trump", "donald trump", "biden", "joe biden", "kamala harris",
      "republican", "republicans", "gop", "democrat", "democrats",
      "congress", "senate", "house of representatives", "supreme court",
      "fbi", "cia", "nsa", "fed", "federal reserve",
    ],
  },
  gb: {
    region: "europe",
    aliases: [
      "united kingdom", "u.k.", "uk", "britain", "british", "great britain",
      "england", "scotland", "wales", "northern ireland",
      "london", "manchester", "edinburgh", "birmingham",
      "downing street", "westminster", "whitehall", "house of commons",
      "tory", "tories", "labour party", "conservative party",
      "rishi sunak", "keir starmer", "king charles",
      "bank of england", "ftse",
    ],
  },
  ir: {
    region: "middle_east",
    aliases: [
      "iran", "iranian", "iranians", "islamic republic",
      "tehran", "isfahan", "shiraz", "tabriz", "mashhad",
      "supreme leader", "ayatollah", "khamenei", "raisi", "pezeshkian",
      "irgc", "revolutionary guard", "revolutionary guards",
      "strait of hormuz", "persian gulf",
    ],
  },
  il: {
    region: "middle_east",
    aliases: [
      "israel", "israeli", "israelis",
      "tel aviv", "jerusalem", "haifa", "gaza", "west bank",
      "netanyahu", "benjamin netanyahu", "idf", "israel defense forces",
      "knesset", "likud", "mossad", "shin bet",
    ],
  },
  sa: {
    region: "middle_east",
    aliases: [
      "saudi arabia", "saudi", "saudis", "kingdom of saudi arabia",
      "riyadh", "jeddah", "mecca", "medina",
      "mbs", "mohammed bin salman", "house of saud",
    ],
  },
  ru: {
    region: "europe",
    aliases: [
      "russia", "russian", "russians", "russian federation",
      "moscow", "st. petersburg", "saint petersburg", "kaliningrad",
      "putin", "vladimir putin", "kremlin", "duma", "fsb",
      "ruble",
    ],
  },
  ua: {
    region: "europe",
    aliases: [
      "ukraine", "ukrainian", "ukrainians",
      "kyiv", "kiev", "kharkiv", "odessa", "lviv", "donetsk", "luhansk",
      "zelensky", "volodymyr zelensky", "rada",
    ],
  },
  cn: {
    region: "east_asia",
    aliases: [
      "china", "chinese", "prc", "people's republic",
      "beijing", "shanghai", "shenzhen", "guangzhou", "hong kong", "macau",
      "xi jinping", "li qiang", "ccp", "communist party of china",
      "taiwan", "taipei",  // note: taiwan ambiguity flagged in P3-1 follow-up
      "yuan", "renminbi",
    ],
  },
  kp: {
    region: "east_asia",
    aliases: [
      "north korea", "north korean", "north koreans", "dprk",
      "pyongyang",
      "kim jong un", "kim jong-un", "kim jong il",
    ],
  },
  jp: {
    region: "east_asia",
    aliases: [
      "japan", "japanese",
      "tokyo", "osaka", "kyoto", "yokohama",
      "fumio kishida", "shinzo abe", "diet of japan",
      "yen", "nikkei", "boj", "bank of japan",
    ],
  },
  kr: {
    region: "east_asia",
    aliases: [
      "south korea", "south korean", "south koreans", "rok", "republic of korea",
      "seoul", "busan", "incheon",
      "yoon suk yeol", "yoon", "samsung", "kospi", "won",
    ],
  },
};

// ── Region → member country codes ────────────────────────────────────────────
// Used by the India audience scorer (source_region fallback) and for future
// region-level audiences.
export const REGIONS = {
  south_asia:    ["in", "pk", "bd", "lk", "np"],
  north_america: ["us", "ca", "mx"],
  europe:        ["gb", "ru", "ua", "fr", "de", "it", "es", "pl", "nl", "se"],
  middle_east:   ["ir", "il", "sa", "tr", "iq", "sy", "eg", "ye", "ae", "qa"],
  east_asia:     ["cn", "jp", "kp", "kr", "tw", "hk"],
};

// ── Intergovernmental / geopolitical entities (text-based detection) ─────────
// Used by the `global` audience scorer — presence of any bumps the geopolitical
// term. Lowercase, word-boundary matched.
//
// Bare "who" is omitted intentionally — it matches ordinary prose ("people
// who…"), which would add a fixed 0.30 to every global-audience score on
// articles that have nothing to do with the organization. Use the expanded
// form so only real references trigger the term.
const GEOPOLITICAL_ENTITIES = [
  "united nations", "nato", "g7", "g20", "imf", "wto",
  "world health organization",
  "opec", "asean", "oecd", "brics", "european union", "eu summit",
  "world bank", "unhcr", "icc", "iaea", "unesco",
];

// ── Global-topic keywords (India-hook detector) ──────────────────────────────
// If text hits any of these AND India is in mentioned_geos, the article scores
// the small "global_topic_with_india_hook" bonus for the India audience.
const GLOBAL_TOPIC_KEYWORDS = [
  "climate summit", "climate change", "cop28", "cop29", "cop30",
  "ai regulation", "ai safety", "artificial intelligence regulation",
  "trade deal", "tariff", "sanctions",
  "supply chain", "semiconductor",
  "pandemic", "vaccine rollout",
  "inflation", "interest rate", "recession",
];

// ── Alias → country_code lookup, sorted so multi-word aliases match first ────
// Prevents false splits: "new delhi" must match before "delhi" so the whole
// phrase is consumed. Longer phrases have more words → sort by word count desc,
// then by length desc as a tiebreaker.
const ALIAS_INDEX = (() => {
  const flat = [];
  for (const [code, { aliases }] of Object.entries(GEO_ALIASES)) {
    for (const alias of aliases) flat.push({ alias: alias.toLowerCase(), code });
  }
  flat.sort((a, b) => {
    const wa = a.alias.split(/\s+/).length;
    const wb = b.alias.split(/\s+/).length;
    if (wa !== wb) return wb - wa;
    return b.alias.length - a.alias.length;
  });
  return flat;
})();

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// P3-1 — reverse alias lookup. Given a place name as the synthesizer LLM
// tagged it (e.g. "Strait of Hormuz", "Manhattan", "Mumbai"), return the
// ISO country code or null. Used by the synthesizer to derive geos from
// `primary_entities_enriched[*]` of type "place" — an editorial-strength
// signal that the gazetteer's aggregate-mention rollup may miss.
export function countryCodeForPlaceName(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const lower = name.toLowerCase().trim();
  // ALIAS_INDEX is sorted multi-word-first; an exact match is what we want
  // here, not a containment check (we're given a single tagged place).
  for (const { alias, code } of ALIAS_INDEX) {
    if (alias === lower) return code;
  }
  return null;
}

function countMatches(lowerText, alias) {
  if (!lowerText) return 0;
  const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "g");
  const m = lowerText.match(re);
  return m ? m.length : 0;
}

// ── extractMentionedGeos ─────────────────────────────────────────────────────
// Returns deduplicated country codes whose alias appears in text.
// Multi-word aliases are matched first, and their spans are masked so a single
// word inside them (e.g. "delhi" inside "new delhi") doesn't double-count as a
// separate alias hit. Country-code dedup happens on top of that.
export function extractMentionedGeos(text) {
  if (!text || typeof text !== "string") return [];
  let scratch = text.toLowerCase();
  const codes = new Set();
  for (const { alias, code } of ALIAS_INDEX) {
    const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "g");
    if (re.test(scratch)) {
      codes.add(code);
      scratch = scratch.replace(re, " ");
    }
  }
  return [...codes];
}

// ── mentionStrength ──────────────────────────────────────────────────────────
// Rough "how much of this article is about country X" signal.
// Match longest aliases first and mask their spans so overlapping aliases
// (e.g. "new delhi" + "delhi", "sri lanka" + the word "sri") count as one hit
// rather than two. Then apply min(1.0, count × 0.25) — three+ mentions saturate.
export function mentionStrength(text, countryCode) {
  if (!text || !countryCode) return 0;
  const entry = GEO_ALIASES[countryCode];
  if (!entry) return 0;
  const sorted = [...entry.aliases]
    .map((a) => a.toLowerCase())
    .sort((a, b) => {
      const wa = a.split(/\s+/).length;
      const wb = b.split(/\s+/).length;
      if (wa !== wb) return wb - wa;
      return b.length - a.length;
    });
  let scratch = text.toLowerCase();
  let total = 0;
  for (const alias of sorted) {
    const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "g");
    const m = scratch.match(re);
    if (m) {
      total += m.length;
      scratch = scratch.replace(re, " ");
    }
  }
  return Math.min(1.0, total * 0.25);
}

function hasAnyKeyword(lowerText, keywords) {
  for (const kw of keywords) {
    if (countMatches(lowerText, kw.toLowerCase()) > 0) return true;
  }
  return false;
}

function regionForCountry(countryCode) {
  if (!countryCode) return null;
  if (GEO_ALIASES[countryCode]?.region) return GEO_ALIASES[countryCode].region;
  for (const [region, members] of Object.entries(REGIONS)) {
    if (members.includes(countryCode)) return region;
  }
  return null;
}

// ── computeArticleAudienceScore ──────────────────────────────────────────────
// Article-level 0.0–1.0 score per audience. Design §7.1.
//
// Tracker 3.5 specifies the positional signature `(source_country,
// mentioned_geos, audience, text)`. The §7.1 formula additionally requires
// `source_region`, `is_global_source`, and `authority_score` — not all of
// which are derivable from the first four args. Callers pass those in via
// the optional 5th `meta` bag so the documented signature stays intact.
export function computeArticleAudienceScore(
  source_country,
  mentioned_geos,
  audience,
  text,
  meta = {},
) {
  const mentions = Array.isArray(mentioned_geos) ? mentioned_geos : [];
  const resolvedRegion =
    meta.source_region ?? regionForCountry(source_country);
  const isGlobalSource = !!meta.is_global_source;
  const authorityScore = Number.isFinite(meta.authority_score)
    ? meta.authority_score
    : 0;
  const lower = (text ?? "").toLowerCase();

  if (audience === "india") {
    // Audience scope: India-primary with South Asia as a softened fallback
    // (subcontinent events read as regionally relevant to Indian readers,
    // but weaker than coverage of India itself). A peer-country mention
    // (pk/bd/lk/np) contributes at SA_PEER_DISCOUNT × the equivalent India
    // mention strength so a Pakistan-only article cannot score like an
    // India-only article.
    const SA_PEER_DISCOUNT = 0.5;
    const indiaStrength = mentions.includes("in") ? mentionStrength(text, "in") : 0;
    let peerStrength = 0;
    for (const c of REGIONS.south_asia) {
      if (c === "in") continue;
      if (mentions.includes(c)) {
        peerStrength = Math.max(peerStrength, mentionStrength(text, c) * SA_PEER_DISCOUNT);
      }
    }
    const strength = Math.max(indiaStrength, peerStrength);

    const globalTopicWithIndiaHook =
      mentions.includes("in") && hasAnyKeyword(lower, GLOBAL_TOPIC_KEYWORDS)
        ? 1
        : 0;

    return (
      0.40 * (source_country === "in" ? 1 : 0) +
      0.35 * strength +
      0.15 * (resolvedRegion === "south_asia" ? 1 : 0) +
      0.10 * globalTopicWithIndiaHook
    );
  }

  if (audience === "global") {
    const entityIsGeopolitical = hasAnyKeyword(lower, GEOPOLITICAL_ENTITIES) ? 1 : 0;
    const multiGeoMention = mentions.length >= 3 ? 1 : 0;

    return (
      0.30 * (isGlobalSource ? 1 : 0) +
      0.30 * entityIsGeopolitical +
      0.25 * multiGeoMention +
      0.15 * Math.max(0, Math.min(1, authorityScore))
    );
  }

  return 0;
}

// ── computePrimaryGeos ───────────────────────────────────────────────────────
// P3-1 — text mentions outweigh publisher geography.
//
// The original rule (mentionRatio ≥ 0.5 OR sourceN ≥ 2) accepted source-
// country alone as evidence a country was "primary". On story 170 (Iran/
// Hormuz) that produced primary_geos = ["in"] from Indian-outlet
// aggregation alone — most articles were published in India, but the story
// is about the Persian Gulf. The renderer's MapCallout therefore pointed at
// India.
//
// New rule:
//   - Strong: mentionRatio ≥ 0.5  →  primary
//   - Corroborated: mentionRatio ≥ 0.25 AND sourceN ≥ 2  →  primary
//   - Source-only (no mentions): NOT primary
//
// Output is sorted by **signal strength descending** instead of alphabetic,
// so MapCallout / `primary_geos[0]` resolves to the strongest geo. Capped
// at 5 to keep payload bounded.
//
// Input: `member_geos` = array of { mentioned_geos, source_country } (one
// entry per cluster member article).
const PRIMARY_GEO_CAP = 5;
const PRIMARY_GEO_MENTION_FLOOR = 0.25;
const PRIMARY_GEO_MENTION_STRONG = 0.5;
const PRIMARY_GEO_SOURCE_CORROBORATION = 2;

export function computePrimaryGeos(member_geos) {
  const members = Array.isArray(member_geos) ? member_geos : [];
  const total = members.length;
  if (total === 0) return [];

  const mentionCount = new Map();
  const sourceCount = new Map();
  for (const a of members) {
    const seen = new Set();
    for (const g of a?.mentioned_geos ?? []) {
      if (!seen.has(g)) {
        seen.add(g);
        mentionCount.set(g, (mentionCount.get(g) ?? 0) + 1);
      }
    }
    if (a?.source_country) {
      sourceCount.set(
        a.source_country,
        (sourceCount.get(a.source_country) ?? 0) + 1,
      );
    }
  }

  const candidates = new Set([...mentionCount.keys(), ...sourceCount.keys()]);
  const scored = [];
  for (const code of candidates) {
    const mentionRatio = (mentionCount.get(code) ?? 0) / total;
    const sourceN = sourceCount.get(code) ?? 0;

    const passes =
      mentionRatio >= PRIMARY_GEO_MENTION_STRONG ||
      (mentionRatio >= PRIMARY_GEO_MENTION_FLOOR && sourceN >= PRIMARY_GEO_SOURCE_CORROBORATION);
    if (!passes) continue;

    // Combined signal: text dominates (×2), source share contributes a small
    // tiebreaker (×0.5, capped at 1). Two countries that both clear the gate
    // get ranked by which one the corpus actually talks about more.
    const signal = mentionRatio * 2 + Math.min(1, sourceN / total) * 0.5;
    scored.push({ code, signal });
  }

  scored.sort((a, b) => {
    if (a.signal !== b.signal) return b.signal - a.signal;
    return a.code.localeCompare(b.code);   // stable tiebreak on code
  });
  return scored.slice(0, PRIMARY_GEO_CAP).map((x) => x.code);
}

// ── computeClusterGeoScores ──────────────────────────────────────────────────
// Per-audience mean of article-level `geo_scores`. Returns a dense map with
// one key per AUDIENCES entry (missing/invalid inputs contribute 0). Shape
// matches tracker 3.7: `{ india: 0.xx, global: 0.yy }`.
//
// Input: `member_geos` = array of article rows each carrying a `geo_scores`
// jsonb (what the clusterer SELECTs from `raw_articles`).
export function computeClusterGeoScores(member_geos) {
  const members = Array.isArray(member_geos) ? member_geos : [];
  const out = {};
  for (const audience of AUDIENCES) {
    let sum = 0;
    let count = 0;
    for (const a of members) {
      const v = a?.geo_scores?.[audience];
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
    out[audience] = count > 0 ? sum / count : 0;
  }
  return out;
}

// ── Audience projection ──────────────────────────────────────────────────────
// Deterministic fixed mapping. Never diverges — both columns are written from
// the same switch so `rank_bucket` and `rank_priority` cannot drift.
const BUCKET_PRIORITY = { hero: 1, standard: 2, tail: 3, filler: 4 };

function bucketFromScore(audience, score, cluster, story) {
  if (audience === "india") {
    const inPrimary = (cluster?.primary_geos ?? []).includes("in");
    if (score >= 12 && inPrimary) return "hero";
    if (score >= 7) return "standard";
    if (score >= 4) return "tail";
    return "filler";
  }
  if (audience === "global") {
    const g = Number(story?.global_significance_score ?? 0);
    if (g >= 14) return "hero";
    if (g >= 10) return "standard";
    if (g >= 6) return "tail";
    return "filler";
  }
  return "filler";
}

function pickReason(audience, cluster, story, extras) {
  const sourceCountries = cluster?.source_countries ?? [];
  const primaryGeos = cluster?.primary_geos ?? [];
  const globalSig = Number(story?.global_significance_score ?? 0);

  if (audience === "india") {
    if (sourceCountries.includes("in") && primaryGeos.includes("in")) {
      return "india-origin source + india-entity mention";
    }
    if (globalSig >= 10 && primaryGeos.includes("in")) {
      return "global story with india hook";
    }
    if (primaryGeos.some((g) => REGIONS.south_asia.includes(g))) {
      return "south-asia regional event";
    }
    return null;
  }
  if (audience === "global") {
    const multiGeo = sourceCountries.length >= 3 || primaryGeos.length >= 3;
    const highAuthorityMultiDomain =
      (extras?.max_authority_score ?? 0) >= 0.7 &&
      (extras?.unique_domain_count ?? (cluster?.unique_domains?.length ?? 0)) >= 3;
    if (globalSig >= 10 && multiGeo) return "wire-service pickup, multi-geo";
    if (highAuthorityMultiDomain) return "global: high authority + multi-domain";
    return null;
  }
  return null;
}

// ── computeAudienceProjection ────────────────────────────────────────────────
// Returns `{ relevance_score, rank_bucket, rank_priority, reason }` per the
// processing contract. `rank_bucket` and `rank_priority` are derived from the
// same branch so they can never diverge (tracker 3.10 invariant).
//
// Signature caveats (flagged for review):
//   - §7.3 `mention_strength_in` is "mean of member raw_articles.geo_scores.in"
//     but the cluster-level map we maintain is per-audience (tracker 3.7). We
//     approximate `mention_strength_in` as `cluster.geo_scores.india`, which
//     already weights India mentions heavily. Callers can override via
//     `extras.mention_strength_in` when a per-country mean is available.
//   - `indian_article_fraction` requires per-country member counts not present
//     on the cluster row. Callers pass it via `extras.indian_article_fraction`
//     (synthesizer will compute it from the SELECT that already pulls member
//     source_country values). Defaults to 0 when absent.
export function computeAudienceProjection(story, cluster, audience, extras = {}) {
  const story_ = story ?? {};
  const cluster_ = cluster ?? {};
  let relevance_score = 0;

  if (audience === "india") {
    const mentionStrengthIn =
      typeof extras.mention_strength_in === "number"
        ? extras.mention_strength_in
        : Number(cluster_.geo_scores?.india ?? 0);
    const indiaSourcePresent = (cluster_.source_countries ?? []).includes("in") ? 1 : 0;
    const indiaIsPrimary = (cluster_.primary_geos ?? []).includes("in") ? 1 : 0;

    const primaryEntities = cluster_.primary_entities ?? [];
    const indiaAliasSet = new Set(GEO_ALIASES.in.aliases.map((a) => a.toLowerCase()));
    const overlap = primaryEntities.filter((e) =>
      indiaAliasSet.has(String(e).toLowerCase()),
    ).length;
    const indiaEntityDensity =
      primaryEntities.length > 0
        ? Math.min(1, overlap / primaryEntities.length)
        : 0;

    const indianArticleFraction = Number.isFinite(extras.indian_article_fraction)
      ? Math.max(0, Math.min(1, extras.indian_article_fraction))
      : 0;

    const globalSig = Number(story_.global_significance_score ?? 0);
    const globalStoryWithIndiaMention =
      globalSig >= 10 && (cluster_.primary_geos ?? []).includes("in") ? 1 : 0;

    relevance_score =
      4 * mentionStrengthIn +
      3 * indiaSourcePresent +
      3 * indiaIsPrimary +
      2 * indiaEntityDensity +
      2 * indianArticleFraction +
      1 * globalStoryWithIndiaMention;
  } else if (audience === "global") {
    relevance_score = Number(story_.global_significance_score ?? 0);
  }

  const rank_bucket = bucketFromScore(audience, relevance_score, cluster_, story_);
  const rank_priority = BUCKET_PRIORITY[rank_bucket];
  const reason = pickReason(audience, cluster_, story_, extras);

  return {
    relevance_score: Number(relevance_score.toFixed(2)),
    rank_bucket,
    rank_priority,
    reason,
  };
}
