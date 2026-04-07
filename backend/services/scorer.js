/**
 * Heuristic Signal Scorer — Quydly
 *
 * Ranks news articles by "Signal Density" and "Systemic Importance."
 * Category-agnostic: relies on structural markers, not topic keywords.
 *
 * Scoring pillars:
 *   1. Information Density  — quantitative richness (numbers, currency, scale)
 *   2. Institutional Agency — formal power entities + systemic action verbs
 *   3. Strategic Impact     — future-pivot language
 *   4. Noise Kill-Switch    — fatal penalty for fluff / soft content
 */

// ── Pillar 1: Information Density ────────────────────────────────────────────

/**
 * Percentages, currency values, and large-scale multipliers.
 * Matches: "4.2%", "$3 billion", "€500 million", "£2 trillion", "2.5 trillion"
 */
const QUANTIFIER_RE = /(?:\d[\d,.]*\s*%|\b(?:\$|€|£)\s*\d[\d,.]*(?:\s*(?:billion|million|trillion))?|\b\d[\d,.]*\s*(?:billion|million|trillion)\b)/gi;

/**
 * Market / macro-economic technical terms.
 * These appear in professional financial and policy reporting.
 */
const MARKET_TERMS_RE = /\b(?:basis\s+points?|bps|ipo|yield|fiscal|gdp|cpi|pmi|repo\s+rate|fed\s+funds|quantitative\s+easing|qe|balance\s+sheet|benchmark\s+rate|bond\s+spread|current\s+account|trade\s+deficit|trade\s+surplus)\b/gi;

// ── Pillar 2: Institutional Agency ───────────────────────────────────────────

/**
 * Power Entity detector: two or more consecutive title-case or all-caps words.
 * Matches: "European Central Bank", "US Senate", "World Trade Organization"
 * Does NOT match: single capitalised words or plain sentences.
 */
const POWER_ENTITY_RE = /\b(?:[A-Z][A-Za-z]{1,}|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z]{1,}|[A-Z]{2,})){1,}\b/g;

/**
 * Formal systemic-action verbs — indicate an institution *did* something
 * consequential, not just commented or predicted.
 */
const SYSTEMIC_VERBS_RE = /\b(?:ratified|sanctioned|legislated|enacted|mandated|imposed|acquired|divested|restructured|nationalised|nationalized|privatised|privatized|dissolved|suspended|indicted|prosecuted|extradited|deposed|expelled|annexed|deployed|mobilised|mobilized|embargoed|proscribed|designated)\b/gi;

// ── Pillar 3: Strategic Impact ───────────────────────────────────────────────

/**
 * Forward-looking pivot markers that signal structural or long-term change
 * rather than a one-off event.
 */
const PIVOT_MARKERS_RE = /\b(?:unveiled|overhauled|restructured|strategic|infrastructure|sovereignty|breakthrough|paradigm|framework|landmark|sweeping|historic|unprecedented|systemic|transformative|foundational|realignment|watershed|inflection)\b/gi;

// ── Pillar 4: Noise Kill-Switch ───────────────────────────────────────────────

/**
 * Generalised fluff / soft-content patterns.
 * Any single match triggers a fatal −100 penalty.
 * Ordered by decreasing specificity for readability.
 */
const NOISE_PATTERNS = [
  // Listicle / how-to formats
  /\b(?:top\s+\d+|how\s+to|tips?\s+for|step[s]?\s+to|ways?\s+to|guide\s+to|tricks?\s+for)\b/i,
  // Lifestyle / wellness verticals
  /\b(?:lifestyle|wellness|self[- ]care|mindfulness|productivity\s+hack|morning\s+routine|life\s+hack|personal\s+finance\s+tip)\b/i,
  // Celebrity / entertainment gossip markers
  /\b(?:celebrity|celebs?|kardashian|influencer|reality\s+(?:tv|show)|goes\s+viral|viral\s+moment|red\s+carpet|breakup|feud|drama)\b/i,
  // Marketing / hype adjectives
  /\b(?:game[- ]changer|revolutionary|must[- ]have|secret\s+to|you\s+(?:need|won't\s+believe|should\s+know)|mind[- ]blowing|jaw[- ]dropping|shocking)\b/i,
  // Soft human-interest framing
  /\b(?:heartwarming|tearful|emotional\s+reunion|opens\s+up\s+about|bravely|courageous\s+battle|slams|blasts|claps\s+back)\b/i,
];

// ── Scoring constants ─────────────────────────────────────────────────────────

const POINTS = {
  perQuantifier:   15,   // each distinct quantifier match
  perMarketTerm:   10,   // each distinct market-term match
  perPowerEntity:   5,   // each distinct multi-word power entity
  perSystemicVerb: 20,   // each distinct systemic-action verb
  perPivotMarker:   8,   // each distinct pivot-marker match
  noisePenalty:  -100,   // fatal — applied once regardless of match count
};

// Caps per pillar prevent a single very dense article from dominating unfairly
const CAPS = {
  dataDensity: 50,  // max from pillar 1
  agency:      55,  // max from pillar 2
  strategic:   24,  // max from pillar 3
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deduplicate regex matches (lower-cased) so repeated words don't inflate score. */
function uniqueMatches(text, regex) {
  const seen = new Set();
  const matches = [];
  for (const m of text.matchAll(regex)) {
    const key = m[0].toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(key)) {
      seen.add(key);
      matches.push(m[0]);
    }
  }
  return matches;
}

/** Check if any noise pattern matches the text. Returns the first matching label, or null. */
function detectNoise(text) {
  for (const re of NOISE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

// ── Core scorer ───────────────────────────────────────────────────────────────

/**
 * Score a single article.
 *
 * @param {{ title: string, description: string, categories?: string[] }} article
 * @returns {{
 *   signalScore: number,
 *   metadata: {
 *     dataDensityScore: number,
 *     agencyScore: number,
 *     strategicScore: number,
 *     noisePenalty: number,
 *     matchedQuantifiers: string[],
 *     matchedMarketTerms: string[],
 *     powerEntities: string[],
 *     matchedVerbs: string[],
 *     matchedPivots: string[],
 *     noiseMatch: string | null,
 *   }
 * }}
 */
function scoreArticle(article) {
  const { title = "", description = "" } = article;
  const fullText = `${title} ${description}`;

  // ── Pillar 4 first — fast exit path for fluff ───────────────────────────
  const noiseMatch = detectNoise(fullText);
  if (noiseMatch !== null) {
    return {
      signalScore: POINTS.noisePenalty,
      metadata: {
        dataDensityScore: 0,
        agencyScore: 0,
        strategicScore: 0,
        noisePenalty: POINTS.noisePenalty,
        matchedQuantifiers: [],
        matchedMarketTerms: [],
        powerEntities: [],
        matchedVerbs: [],
        matchedPivots: [],
        noiseMatch,
      },
    };
  }

  // ── Pillar 1: Information Density ──────────────────────────────────────
  const matchedQuantifiers = uniqueMatches(fullText, QUANTIFIER_RE);
  const matchedMarketTerms = uniqueMatches(fullText, MARKET_TERMS_RE);

  const rawDataDensity =
    matchedQuantifiers.length * POINTS.perQuantifier +
    matchedMarketTerms.length * POINTS.perMarketTerm;
  const dataDensityScore = Math.min(CAPS.dataDensity, rawDataDensity);

  // ── Pillar 2: Institutional Agency ─────────────────────────────────────
  const powerEntities = uniqueMatches(fullText, POWER_ENTITY_RE);
  const matchedVerbs  = uniqueMatches(fullText, SYSTEMIC_VERBS_RE);

  const rawAgency =
    powerEntities.length * POINTS.perPowerEntity +
    matchedVerbs.length  * POINTS.perSystemicVerb;
  const agencyScore = Math.min(CAPS.agency, rawAgency);

  // ── Pillar 3: Strategic Impact ─────────────────────────────────────────
  const matchedPivots = uniqueMatches(fullText, PIVOT_MARKERS_RE);
  const strategicScore = Math.min(
    CAPS.strategic,
    matchedPivots.length * POINTS.perPivotMarker
  );

  // ── Final score ────────────────────────────────────────────────────────
  const signalScore = dataDensityScore + agencyScore + strategicScore;

  return {
    signalScore,
    metadata: {
      dataDensityScore,
      agencyScore,
      strategicScore,
      noisePenalty: 0,
      matchedQuantifiers,
      matchedMarketTerms,
      powerEntities,
      matchedVerbs,
      matchedPivots,
      noiseMatch: null,
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score and rank an array of articles by signalScore (descending).
 * Attaches `signalScore` and `metadata` to each article in-place.
 *
 * @param {Array<{ title: string, description: string, categories?: string[] }>} articles
 * @returns {Array} Same articles, sorted best-first, each with signalScore + metadata.
 */
export function rankArticles(articles) {
  return articles
    .map((article) => {
      const { signalScore, metadata } = scoreArticle(article);
      return { ...article, signalScore, metadata };
    })
    .sort((a, b) => b.signalScore - a.signalScore);
}

/**
 * Score a single article (exported for testing).
 * @param {{ title: string, description: string }} article
 * @returns {{ signalScore: number, metadata: object }}
 */
export { scoreArticle };
