#!/usr/bin/env node
// Phase 5.6 smoke — send a curated mix of real article URLs (global + India
// origin + India-topical) to scrape-queue so the running article-scraper
// exercises the new geo enrichment path against live content.
//
// Usage:
//   npm start                         # in one terminal (func start)
//   node test/send-geo-smoke.js       # in another
//   node test/verify-geo.js           # once processing logs settle
//
// URLs are section/index pages from domains already in rss-feeds.js so
// lookupFeedByDomain hits. Section pages tend to have enough text that
// Readability clears MIN_CONTENT_LENGTH=200; swap in article URLs if any
// specific source fails to parse.

import { hashUrl } from "../lib/canonicalise.js";
import { sbClient, cleanup } from "./helpers.js";

const URLS = [
  // India origin (source_country='in') — should flip is_global_candidate=false
  // and score high on the India audience.
  { url: "https://www.thehindu.com/news/national/",         domain: "thehindu.com",         category: "world",   authority_score: 0.8 },
  { url: "https://indianexpress.com/section/india/",        domain: "indianexpress.com",    category: "world",   authority_score: 0.8 },
  { url: "https://www.hindustantimes.com/india-news",       domain: "hindustantimes.com",   category: "world",   authority_score: 0.6 },

  // Global source with an India beat — should still classify as global_source
  // and likely mention 'in' in text. (All domains must be in rss-feeds.js so
  // lookupFeedByDomain hits — add new ones there first.)
  { url: "https://www.theguardian.com/world/india",         domain: "theguardian.com",      category: "world",   authority_score: 0.8 },
  { url: "https://www.bbc.com/news/world/asia/india",       domain: "bbc.com",              category: "world",   authority_score: 0.8 },

  // Global, non-India — is_global_candidate only if ≥2 country aliases hit.
  { url: "https://www.aljazeera.com/news/",                 domain: "aljazeera.com",        category: "world",   authority_score: 0.8 },
  { url: "https://www.dw.com/en/top-stories/s-9097",        domain: "dw.com",               category: "world",   authority_score: 0.6 },
  { url: "https://www.france24.com/en/tag/india/",          domain: "france24.com",         category: "world",   authority_score: 0.6 },
];

try {
  console.log(`\n=== Sending ${URLS.length} geo-smoke messages to scrape-queue ===\n`);

  const sender = sbClient.createSender("scrape-queue");
  let sent = 0;

  for (const u of URLS) {
    const canonical_url = u.url;
    const url_hash = hashUrl(canonical_url);

    // Jitter the URL per-run so repeated invocations create fresh url_hashes
    // (otherwise ON CONFLICT DO NOTHING hides subsequent runs).
    const jittered = `${canonical_url}?geo_smoke=${Date.now()}`;
    const hash = hashUrl(jittered);

    await sender.sendMessages({
      body: {
        url_hash:        hash,
        canonical_url:   jittered,
        source_domain:   u.domain,
        category_id:     u.category,
        authority_score: u.authority_score,
        published_at:    new Date().toISOString(),
        title:           null,
        summary:         null,
      },
      messageId: hash,
    });

    sent++;
    console.log(`  sent ${u.domain.padEnd(28)} ${canonical_url}`);
  }

  await sender.close();
  console.log(`\nDone — ${sent} messages queued.`);
  console.log("Run `npm start` (func start) to process, then `node test/verify-geo.js`.");
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
