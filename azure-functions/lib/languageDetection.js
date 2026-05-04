// P2-4 — language detection + aggregation for translation-required flag.
//
// Two signals combine:
//   1. raw_articles.language (feed metadata, set by the scraper) — the
//      authoritative source-language tag.
//   2. Script detection on article body — catches non-Latin quotes
//      embedded in articles whose feed is tagged "en". Defends against
//      a story syntheised from English wire copy that quotes a Hindi
//      politician verbatim — the source language is partly Hindi even
//      if the feed tag says English.
//
// Both signals roll up to the story-level columns:
//   - original_languages text[]   — sorted unique ISO codes
//   - translation_required bool   — true when any article is non-English
//                                    (by either signal)
//
// Pure functions, no I/O. The synthesizer calls aggregateArticleLanguages
// once per story write.

// Unicode-block ranges keyed by best-effort ISO 639-1 code. Order matters
// only for ranking unknown text; aggregation just OR's all matches.
const SCRIPT_RANGES = Object.freeze([
  { code: "hi",  pattern: /[ऀ-ॿ]/ },   // Devanagari (Hindi/Marathi/Sanskrit)
  { code: "ar",  pattern: /[؀-ۿ]/ },   // Arabic
  { code: "fa",  pattern: /[ݐ-ݿ]/ },   // Persian extension (subset of Arabic block — keeping for codepoint specificity)
  { code: "zh",  pattern: /[一-鿿]/ },   // CJK Unified Ideographs (Chinese, also some Japanese kanji)
  { code: "ja",  pattern: /[぀-ヿ]/ },   // Hiragana + Katakana (Japanese-only)
  { code: "ko",  pattern: /[가-힯]/ },   // Hangul syllables
  { code: "ru",  pattern: /[Ѐ-ӿ]/ },   // Cyrillic
  { code: "he",  pattern: /[֐-׿]/ },   // Hebrew
  { code: "th",  pattern: /[฀-๿]/ },   // Thai
  { code: "ta",  pattern: /[஀-௿]/ },   // Tamil
  { code: "te",  pattern: /[ఀ-౿]/ },   // Telugu
  { code: "bn",  pattern: /[ঀ-৿]/ },   // Bengali
  { code: "gu",  pattern: /[઀-૿]/ },   // Gujarati
  { code: "kn",  pattern: /[ಀ-೿]/ },   // Kannada
  { code: "ml",  pattern: /[ഀ-ൿ]/ },   // Malayalam
  { code: "pa",  pattern: /[਀-੿]/ },   // Gurmukhi (Punjabi)
]);

// Minimum number of script-character matches before we count a body as
// containing that script. A single stray glyph in a brand name or quote
// shouldn't trip the flag — but a paragraph of Hindi clearly should.
// 8 codepoints is roughly two short Devanagari words.
const SCRIPT_MIN_HITS = 8;

/**
 * Detect non-Latin scripts present in `text`. Returns an array of ISO codes
 * (lowercase) for any script with ≥ SCRIPT_MIN_HITS codepoints. Multiple
 * scripts can return at once (e.g. an article mixing Hindi and Arabic).
 *
 * Returns [] for plain Latin / English text — Latin script doesn't trigger.
 */
export function detectScriptLanguages(text) {
  if (typeof text !== "string" || !text) return [];
  const found = new Set();
  for (const { code, pattern } of SCRIPT_RANGES) {
    // Count matches via global regex; cheap on short strings.
    const re = new RegExp(pattern.source, "g");
    const matches = text.match(re);
    if (matches && matches.length >= SCRIPT_MIN_HITS) found.add(code);
  }
  return [...found];
}

/**
 * Aggregate language signals across an article set.
 *
 * @param {Array<{language?: string|null, title?: string, description?: string, content?: string}>} articles
 * @returns {{ original_languages: string[], translation_required: boolean }}
 */
export function aggregateArticleLanguages(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return { original_languages: [], translation_required: false };
  }

  const langs = new Set();
  let needsFlag = false;

  for (const a of articles) {
    // 1. Feed-metadata language (authoritative).
    const feedLang = typeof a?.language === "string" ? a.language.toLowerCase().trim() : null;
    if (feedLang) {
      langs.add(feedLang);
      if (feedLang !== "en") needsFlag = true;
    }

    // 2. Script detection in article body. Catches non-Latin embedded text
    // in articles whose feed tag claims English.
    const bodyText = [a?.title, a?.description, a?.content]
      .filter((s) => typeof s === "string")
      .join(" ");
    const detected = detectScriptLanguages(bodyText);
    for (const code of detected) {
      langs.add(code);
      if (code !== "en") needsFlag = true;
    }
  }

  return {
    original_languages: [...langs].sort(),
    translation_required: needsFlag,
  };
}

export const SCRIPT_MIN_HITS_FOR_TEST = SCRIPT_MIN_HITS;
