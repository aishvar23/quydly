// AI-topic detection for category re-tagging.
//
// The `ai` content vertical starves because most genuine AI press coverage is
// tagged `tech` (and occasionally `finance`/`world`) and walled off from `ai`
// clusters by the strictly category-scoped clusterer (article-clusterer/index.js).
// This module detects AI-topic articles by keyword so:
//   - article-scraper can re-tag them to `ai` at scrape time (gated by
//     AI_RETAG_ENABLED), and
//   - a one-time backfill can recover the already-scraped backlog.
//
// Keyword-based, not LLM: scrape volume makes a per-article model call too
// costly. Tuned for PRECISION since the source set includes `finance`/`world`:
// a STRONG, unambiguous signal in the title/description re-tags on its own;
// otherwise we require >=2 distinct signals across the full text. That keeps a
// genuinely-tech/finance article that merely mentions "AI" in passing from
// being pulled into the `ai` vertical.

// Categories we re-tag FROM. AI is a subset of these. `science`/`culture` and
// already-`ai` articles are left alone. Widen here if the leak appears elsewhere.
export const RETAG_SOURCE_CATEGORIES = ["tech", "finance", "world"];
export const RETAG_TARGET_CATEGORY  = "ai";

// Only the first N chars of body content are scanned — keeps the regex pass
// bounded on long articles and mirrors the geo-enrichment slice in the scraper.
const CONTENT_SLICE = 2000;

// STRONG signals — unambiguous AI references. A single hit in the title or
// description is enough to re-tag. (Ambiguous single-word product names like
// "Claude"/"Gemini"/"Llama"/"Sora"/"Copilot" are intentionally NOT here — they
// double as a person/zodiac/animal/role and live in WEAK below.)
const STRONG_TERMS = [
  // Labs / orgs
  "OpenAI", "Anthropic", "DeepMind", "Hugging Face", "Stability AI", "xAI",
  // Models / products
  "ChatGPT", "GPT-3", "GPT-4", "GPT-4o", "GPT-5", "Midjourney",
  "Stable Diffusion", "DALL-E", "DALL·E",
  // Concept phrases
  "artificial intelligence", "large language model", "large language models",
  "LLM", "LLMs", "generative AI", "gen AI", "foundation model",
  "AI model", "AI models", "AI chatbot", "AI assistant", "AI agent",
];

// WEAK signals — AI-adjacent but ambiguous on their own. Only count toward the
// ">=2 distinct signals anywhere" rule; never re-tag in isolation.
const WEAK_TERMS = [
  "Claude", "Gemini", "Llama", "Sora", "Copilot", "Mistral", "Cohere",
  "machine learning", "deep learning", "neural network", "neural networks",
  "AI", "chatbot",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a case-insensitive matcher with word boundaries on word-char edges so
// short tokens don't match substrings ("AI" must not fire inside "Dubai",
// "GPT" not inside a longer code). Non-word edges (e.g. trailing in "DALL·E")
// simply get no boundary on that side.
function termToRegex(term) {
  const esc   = escapeRegex(term);
  const left  = /^\w/.test(term) ? "\\b" : "";
  const right = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${left}${esc}${right}`, "i");
}

const STRONG_RES = STRONG_TERMS.map(termToRegex);
const ALL_RES    = [...STRONG_TERMS, ...WEAK_TERMS].map(termToRegex);

// All signal terms, exported for tests / tuning visibility.
export const AI_SIGNAL_TERMS = { strong: STRONG_TERMS, weak: WEAK_TERMS };

// True when the article is about AI. See module header for the precision rules.
export function isAiTopic({ title, description, content } = {}) {
  const head = `${title || ""}\n${description || ""}`;
  const full = `${head}\n${content ? String(content).slice(0, CONTENT_SLICE) : ""}`;

  // (a) any STRONG term in the high-precision fields (title/description)
  for (const re of STRONG_RES) {
    if (re.test(head)) return true;
  }

  // (b) >=2 distinct signal terms anywhere in title + description + content head
  let distinct = 0;
  for (const re of ALL_RES) {
    if (re.test(full)) {
      distinct++;
      if (distinct >= 2) return true;
    }
  }

  return false;
}

// Returns `ai` when `currentCategory` is re-taggable and the article is AI-topic;
// otherwise returns `currentCategory` unchanged.
export function retagCategory(currentCategory, fields) {
  if (!RETAG_SOURCE_CATEGORIES.includes(currentCategory)) return currentCategory;
  return isAiTopic(fields) ? RETAG_TARGET_CATEGORY : currentCategory;
}
