/**
 * Context Enrichment Service — Quydly
 *
 * Responsible only for scraping full article bodies and preparing
 * the enriched payload for the LLM pipeline.
 *
 * Scoring and ranking is NOT done here — that is the scorer's job.
 * This service receives a pre-ranked, pre-filtered array and enriches it.
 *
 *   enrichArticles(rankedArticles)
 *     For each article, scrape the full body via the article's `link`.
 *     A 300ms courtesy delay is observed between requests.
 *     On failure, falls back to the original `description`.
 *     Returns the same array with `enrichedContext` and `isLowDetail` attached.
 */

import { ENRICHED_CONTEXT_MAX_CHARS } from "./scraper.js";

/**
 * Enrich a single article with the richest available context, in priority order:
 *   1. NewsData `content` field  — full text, available on paid plans
 *   2. NewsData `description`   — short summary
 *   3. Article `title`          — last resort
 *
 * @param {object} article — Must have `title`, `description`, `content` fields.
 * @returns {object} Article with `enrichedContext` and `isLowDetail` attached.
 */
export function enrichArticle(article) {
  // Priority 1: NewsData content field (paid plan — full text)
  if (article.content && article.content.length >= 100) {
    return {
      ...article,
      enrichedContext: article.content.slice(0, ENRICHED_CONTEXT_MAX_CHARS),
      isLowDetail: false,
    };
  }

  // Priority 2: description
  if (article.description && article.description.length >= 30) {
    return {
      ...article,
      enrichedContext: article.description.slice(0, ENRICHED_CONTEXT_MAX_CHARS),
      isLowDetail: true,
    };
  }

  // Priority 3: title only
  console.warn(
    `[enricher] no description available — using title only for: ${(article.title ?? "").slice(0, 60)}`
  );
  return {
    ...article,
    enrichedContext: article.title ?? "",
    isLowDetail: true,
  };
}

/**
 * Sequentially enrich an array of pre-ranked articles.
 * Applies a 300ms delay between requests (good-citizen policy).
 *
 * @param {object[]} rankedArticles — Already scored and sliced by generateDaily.
 * @returns {object[]} Same articles with `enrichedContext` + `isLowDetail`.
 */
export function enrichArticles(rankedArticles) {
  console.log(`[enricher] enriching ${rankedArticles.length} articles...`);

  let rich = 0;
  let fallbacks = 0;

  const enriched = rankedArticles.map((article, i) => {
    const result = enrichArticle(article);

    if (result.isLowDetail) fallbacks++;
    else rich++;

    const source = result.isLowDetail ? "FALLBACK" : "content ";
    console.log(
      `[enricher] ${i + 1}/${rankedArticles.length} — ` +
      `${source} [signal=${article.signalScore}] ${(article.title ?? "").slice(0, 55)}`
    );

    return result;
  });

  console.log(
    `[enricher] done — ${rich} rich, ${fallbacks} fallbacks ` +
    `(${Math.round((rich / enriched.length) * 100)}% rich rate)`
  );

  return enriched;
}
