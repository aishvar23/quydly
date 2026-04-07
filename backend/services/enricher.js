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

import { scrapeArticleBody, ENRICHED_CONTEXT_MAX_CHARS } from "./scraper.js";

const SCRAPE_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Enrich a single article with the richest available context, in priority order:
 *   1. NewsData `content` field  — full text, available on paid plans
 *   2. Scraped article body      — fallback if content is absent/short
 *   3. NewsData `description`    — last resort (short summary)
 *
 * @param {object} article — Must have `title`, `description`, `content`, `link` fields.
 * @returns {Promise<object>} Article with `enrichedContext` and `isLowDetail` attached.
 */
export async function enrichArticle(article) {
  // Priority 1: NewsData content field (paid plan — no network cost, no bot detection)
  if (article.content && article.content.length >= 100) {
    return {
      ...article,
      enrichedContext: article.content.slice(0, ENRICHED_CONTEXT_MAX_CHARS),
      isLowDetail: false,
    };
  }

  // Priority 2: Scrape the article URL
  const scraped = await scrapeArticleBody(article.link ?? null);
  if (scraped && scraped.length >= 100) {
    return { ...article, enrichedContext: scraped, isLowDetail: false };
  }

  // Priority 3: Fall back to description
  console.warn(
    `[enricher] no rich content available — falling back to description for: ${(article.title ?? "").slice(0, 60)}`
  );

  return {
    ...article,
    enrichedContext: (article.description ?? "").slice(0, ENRICHED_CONTEXT_MAX_CHARS),
    isLowDetail: true,
  };
}

/**
 * Sequentially enrich an array of pre-ranked articles.
 * Applies a 300ms delay between requests (good-citizen policy).
 *
 * @param {object[]} rankedArticles — Already scored and sliced by generateDaily.
 * @returns {Promise<object[]>} Same articles with `enrichedContext` + `isLowDetail`.
 */
export async function enrichArticles(rankedArticles) {
  console.log(`[enricher] enriching ${rankedArticles.length} articles (${SCRAPE_DELAY_MS}ms delay between requests)...`);

  const enriched = [];
  let scraped = 0;
  let fallbacks = 0;

  for (let i = 0; i < rankedArticles.length; i++) {
    const result = await enrichArticle(rankedArticles[i]);
    enriched.push(result);

    if (result.isLowDetail) fallbacks++;
    else scraped++;

    const source = result.isLowDetail ? "FALLBACK" : rankedArticles[i].content ? "content " : "scraped ";
    console.log(
      `[enricher] ${i + 1}/${rankedArticles.length} — ` +
      `${source} [signal=${rankedArticles[i].signalScore}] ${(rankedArticles[i].title ?? "").slice(0, 55)}`
    );

    if (i < rankedArticles.length - 1) await sleep(SCRAPE_DELAY_MS);
  }

  console.log(
    `[enricher] done — ${scraped} scraped, ${fallbacks} fallbacks ` +
    `(${Math.round((scraped / enriched.length) * 100)}% enrichment rate)`
  );

  return enriched;
}
