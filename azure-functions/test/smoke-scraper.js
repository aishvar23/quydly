#!/usr/bin/env node
// Smoke test 5.8 — Call article-scraper directly with real URLs.
//
// Usage: node test/smoke-scraper.js
//
// What it does:
//   1. Picks 10 real news URLs
//   2. Inserts them into scrape_queue (so the scraper's status updates work)
//   3. Calls the article-scraper handler directly for each one
//   4. Reports results: which succeeded, which failed, raw_articles created
//
// No `func start` needed — this invokes the handler in-process.

import articleScraper from "../article-scraper/index.js";
import { hashUrl } from "../lib/canonicalise.js";
import { supabase, fakeContext, cleanup } from "./helpers.js";

const ctx = fakeContext("smoke-scraper");

const TEST_URLS = [
  { url: "https://www.bbc.com/news",                   domain: "bbc.com",         category: "world" },
  { url: "https://www.reuters.com/world",              domain: "reuters.com",     category: "world" },
  { url: "https://techcrunch.com",                     domain: "techcrunch.com",  category: "tech" },
  { url: "https://arstechnica.com",                    domain: "arstechnica.com", category: "tech" },
  { url: "https://www.theguardian.com/international",  domain: "theguardian.com", category: "world" },
  { url: "https://www.npr.org/sections/news",          domain: "npr.org",         category: "world" },
  { url: "https://www.wired.com",                      domain: "wired.com",       category: "tech" },
  { url: "https://www.theverge.com",                   domain: "theverge.com",    category: "tech" },
  { url: "https://apnews.com",                         domain: "apnews.com",      category: "world" },
  { url: "https://www.aljazeera.com/news",             domain: "aljazeera.com",   category: "world" },
];

try {
  console.log("\n=== Phase 5.8: Article-Scraper Smoke Test ===\n");

  const results = { done: 0, low_quality: 0, failed: 0, throttled: 0 };

  // Count raw_articles before
  const { count: beforeCount } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true });

  console.log(`raw_articles before: ${beforeCount}\n`);

  for (let i = 0; i < TEST_URLS.length; i++) {
    const { url, domain, category } = TEST_URLS[i];
    const testUrl = `${url}?_smoke=${Date.now()}-${i}`;
    const url_hash = hashUrl(testUrl);

    // Insert into scrape_queue so the scraper's status updates don't fail
    await supabase
      .from("scrape_queue")
      .upsert({
        url_hash,
        canonical_url: testUrl,
        domain,
        category_id: category,
        authority_score: 0.7,
        status: "PENDING",
      }, { onConflict: "url_hash", ignoreDuplicates: true });

    // Build the message object (same shape as what SB delivers)
    const message = {
      url_hash,
      canonical_url:   testUrl,
      source_domain:   domain,
      category_id:     category,
      authority_score: 0.7,
      published_at:    new Date().toISOString(),
      title:           `Smoke test article from ${domain}`,
      summary:         `Test summary for ${domain}`,
    };

    const label = `[${i + 1}/${TEST_URLS.length}] ${domain}`;
    try {
      await articleScraper(ctx, message);

      // Check what status it got
      const { data: row } = await supabase
        .from("scrape_queue")
        .select("status")
        .eq("url_hash", url_hash)
        .single();

      const status = row?.status ?? "UNKNOWN";
      console.log(`  ${label} → ${status}`);

      if (status === "DONE") results.done++;
      else if (status === "LOW_QUALITY") results.low_quality++;
      else results.failed++;
    } catch (err) {
      console.log(`  ${label} → FAILED (${err.message.slice(0, 80)})`);
      results.failed++;
    }
  }

  // Count raw_articles after
  const { count: afterCount } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true });

  const newArticles = afterCount - beforeCount;

  console.log("\n--- Results ---");
  console.log(`  DONE:        ${results.done}`);
  console.log(`  LOW_QUALITY: ${results.low_quality}`);
  console.log(`  FAILED:      ${results.failed}`);
  console.log(`  raw_articles created: ${newArticles}`);

  if (results.done > 0) {
    console.log("\nPASS: article-scraper successfully fetched and parsed articles");
  } else {
    console.log("\nWARN: 0 articles with status DONE — check network access and HTML parsing");
  }
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
