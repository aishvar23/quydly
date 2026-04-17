#!/usr/bin/env node
// Smoke test 5.8 + Load test 5.9 — Send N messages to scrape-queue.
//
// Usage:
//   node test/send-scrape-messages.js          # sends 10 (smoke test)
//   node test/send-scrape-messages.js 200      # sends 200 (load test)
//
// Messages use real, scrapeable news URLs so the article-scraper can
// actually fetch + parse them. After sending, run `func start` to let
// the scraper process them, then run `node test/verify.js` to check results.

import { hashUrl } from "../lib/canonicalise.js";
import { sbClient, cleanup } from "./helpers.js";

const COUNT = parseInt(process.argv[2] || "10", 10);

const TEST_URLS = [
  "https://www.bbc.com/news",
  "https://www.reuters.com/world",
  "https://www.theguardian.com/international",
  "https://www.aljazeera.com/news",
  "https://www.npr.org/sections/news",
  "https://techcrunch.com",
  "https://arstechnica.com",
  "https://www.wired.com",
  "https://www.theverge.com",
  "https://www.engadget.com",
  "https://apnews.com",
  "https://www.france24.com/en",
  "https://abcnews.go.com",
  "https://www.dw.com/en",
  "https://www.cnn.com",
  "https://www.nbcnews.com",
  "https://www.washingtonpost.com",
  "https://www.politico.com",
  "https://www.axios.com",
  "https://www.vox.com",
];

const DOMAINS = ["bbc.com", "reuters.com", "theguardian.com", "aljazeera.com", "npr.org",
  "techcrunch.com", "arstechnica.com", "wired.com", "theverge.com", "engadget.com",
  "apnews.com", "france24.com", "abcnews.go.com", "dw.com", "cnn.com",
  "nbcnews.com", "washingtonpost.com", "politico.com", "axios.com", "vox.com"];

const CATEGORIES = ["world", "tech", "business", "science", "health"];

try {
  console.log(`\n=== Sending ${COUNT} messages to scrape-queue ===\n`);

  const sender = sbClient.createSender("scrape-queue");
  let sent = 0;

  for (let i = 0; i < COUNT; i++) {
    const idx = i % TEST_URLS.length;
    const testUrl = `${TEST_URLS[idx]}/test-article-${Date.now()}-${i}`;
    const url_hash = hashUrl(testUrl);

    const msg = {
      body: {
        url_hash,
        canonical_url:   testUrl,
        source_domain:   DOMAINS[idx],
        category_id:     CATEGORIES[i % CATEGORIES.length],
        authority_score: 0.6,
        published_at:    new Date().toISOString(),
        title:           `Test Article #${i + 1} from ${DOMAINS[idx]}`,
        summary:         `Test summary for article ${i + 1}`,
      },
      messageId: url_hash,
    };

    await sender.sendMessages(msg);
    sent++;

    if (sent % 50 === 0) {
      console.log(`  sent ${sent}/${COUNT}...`);
    }
  }

  await sender.close();
  console.log(`\nDone — ${sent} messages sent to scrape-queue`);
  console.log("Now run `func start` and watch the article-scraper process them.");
  console.log("Then run `node test/verify.js` to check results.");
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
