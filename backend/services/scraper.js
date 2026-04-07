/**
 * Context Enrichment Scraper — Quydly
 *
 * Fetches the full article body from a news URL and returns cleaned plain text.
 * Used to build `enrichedContext` for the LLM question-generation prompt.
 *
 * Design principles:
 *  - Realistic User-Agent to reduce bot-detection rejections
 *  - Targeted extraction: <article> → <main> → content/body divs → <p> fallback
 *  - Strips scripts, styles, ads, nav, and other noise before extracting text
 *  - 5-second timeout; any failure returns null (caller handles fallback)
 *  - Good-citizen: caller is responsible for the 300ms inter-request delay
 */

import axios from "axios";
import * as cheerio from "cheerio";

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 5_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

/** Enriched context is capped at this length before being handed to the LLM. */
export const ENRICHED_CONTEXT_MAX_CHARS = 2_500;

/**
 * CSS selectors tried in priority order to find the article's main text block.
 * First selector that returns non-empty text wins.
 */
const CONTENT_SELECTORS = [
  "article",
  "main",
  '[class*="article-body"]',
  '[class*="article_body"]',
  '[class*="articleBody"]',
  '[class*="story-body"]',
  '[class*="story_body"]',
  '[class*="post-content"]',
  '[class*="post_content"]',
  '[class*="entry-content"]',
  '[class*="entry_content"]',
  '[class*="content-body"]',
  '[class*="content_body"]',
  '[id*="article"]',
  '[id*="content"]',
  '[id*="main"]',
];

/**
 * Elements stripped before text extraction.
 * Removes ads, navigation, paywalls, social widgets, and boilerplate.
 */
const NOISE_SELECTORS =
  "script, style, noscript, iframe, " +
  "nav, header, footer, aside, " +
  '[class*="ad"], [class*="advertisement"], [id*="ad-"], ' +
  '[class*="paywall"], [class*="subscribe"], [class*="newsletter"], ' +
  '[class*="related"], [class*="recommended"], [class*="more-stories"], ' +
  '[class*="social"], [class*="share"], [class*="comment"], ' +
  '[class*="cookie"], [class*="consent"], [class*="gdpr"], ' +
  '[class*="popup"], [class*="modal"], [class*="overlay"], ' +
  "figure, figcaption";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Given a loaded Cheerio root, strip noise elements and extract clean text
 * from the best available content container.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string} Cleaned plain text, or empty string if nothing found.
 */
function extractText($) {
  // Remove all noise elements globally before any extraction
  $(NOISE_SELECTORS).remove();

  // Try each content selector in priority order
  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector).first();
    if (el.length === 0) continue;

    const text = el
      .find("p")
      .map((_, p) => $(p).text().trim())
      .get()
      .filter((t) => t.length > 40) // drop captions, labels, and one-liners
      .join("\n\n");

    if (text.length > 200) return text;
  }

  // Final fallback: all <p> tags in the document
  const fallback = $("p")
    .map((_, p) => $(p).text().trim())
    .get()
    .filter((t) => t.length > 40)
    .join("\n\n");

  return fallback;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch and parse the full body of a news article.
 *
 * @param {string} url — The article URL (the `link` field from NewsData.io)
 * @returns {Promise<string | null>}
 *   Cleaned text (up to ENRICHED_CONTEXT_MAX_CHARS), or null on any failure.
 */
export async function scrapeArticleBody(url) {
  if (!url || typeof url !== "string") return null;

  let html;
  try {
    const response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.google.com/",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
      },
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    html = response.data;
  } catch (err) {
    const reason = err.code ?? err.response?.status ?? err.message ?? "unknown";
    console.warn(`[scraper] fetch failed for ${url} — ${reason}`);
    return null;
  }

  let text;
  try {
    const $ = cheerio.load(html);
    text = extractText($);
  } catch (err) {
    console.warn(`[scraper] parse failed for ${url} — ${err.message}`);
    return null;
  }

  if (!text || text.length < 100) {
    console.warn(`[scraper] insufficient content extracted from ${url}`);
    return null;
  }

  return text.slice(0, ENRICHED_CONTEXT_MAX_CHARS);
}
