// Phase 5.2 — Batch processing worker
// Pulls PENDING items from scrape_queue, scrapes them, writes to raw_articles.
// Concurrency: global = 8, per-domain = 2, MAX_RETRIES = 3.

import { createClient } from "@supabase/supabase-js";
import { scrapeArticle } from "./scraper.js";

const BATCH_LIMIT = 200;      // items claimed per run — ceil(200/8)×8s = 200s, fits in 300s maxDuration
const GLOBAL_CONCURRENCY = 8;
const PER_DOMAIN_CONCURRENCY = 2;
const MAX_RETRIES = 3;

function buildSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

// Minimal semaphore for concurrency control
function makeSemaphore(max) {
  let running = 0;
  const queue = [];
  return {
    async acquire() {
      if (running < max) { running++; return; }
      await new Promise((resolve) => queue.push(resolve));
      running++;
    },
    release() {
      running--;
      if (queue.length > 0) queue.shift()();
    },
  };
}

export async function runProcessing() {
  const supabase = buildSupabase();

  // Claim a batch atomically: set status = PROCESSING
  const { data: items, error: claimError } = await supabase
    .from("scrape_queue")
    .select("id, url_hash, canonical_url, domain, category_id, authority_score, retry_count, published_at")
    .eq("status", "PENDING")
    .lte("retry_count", MAX_RETRIES - 1)
    .order("authority_score", { ascending: false })
    .order("discovered_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (claimError) {
    console.error(JSON.stringify({ event: "claim_error", error: claimError.message }));
    return;
  }
  if (!items || items.length === 0) {
    console.log(JSON.stringify({ event: "no_pending_items" }));
    return;
  }

  const ids = items.map((i) => i.id);
  await supabase
    .from("scrape_queue")
    .update({ status: "PROCESSING" })
    .in("id", ids);

  const globalSem = makeSemaphore(GLOBAL_CONCURRENCY);
  const domainSems = new Map();

  function getDomainSem(domain) {
    if (!domainSems.has(domain)) {
      domainSems.set(domain, makeSemaphore(PER_DOMAIN_CONCURRENCY));
    }
    return domainSems.get(domain);
  }

  let done = 0, partial = 0, low_quality = 0, failed = 0;

  await Promise.all(
    items.map(async (item) => {
      const domSem = getDomainSem(item.domain);
      await globalSem.acquire();
      await domSem.acquire();

      try {
        const result = await scrapeArticle(item.canonical_url);
        const queueStatus = result.status === "DONE" ? "DONE"
          : result.status === "LOW_QUALITY" ? "LOW_QUALITY"
          : "PARTIAL";

        // Update queue row
        await supabase
          .from("scrape_queue")
          .update({ status: queueStatus, processed_at: new Date().toISOString() })
          .eq("id", item.id);

        // Insert into raw_articles (DONE or LOW_QUALITY stored, PARTIAL skipped)
        if (result.title) {
          const { error: insertErr } = await supabase
            .from("raw_articles")
            .upsert(
              {
                url_hash: item.url_hash,
                canonical_url: item.canonical_url,
                domain: item.domain,
                category_id: item.category_id,
                title: result.title,
                description: result.description ?? null,
                content: result.content ?? null,
                content_hash: result.content_hash ?? null,
                author: result.author ?? null,
                published_at: item.published_at ?? null,
                authority_score: item.authority_score,
                status: queueStatus,
                is_verified: true,
              },
              { onConflict: "url_hash", ignoreDuplicates: true }
            );

          if (insertErr) {
            console.error(
              JSON.stringify({ event: "article_insert_error", url: item.canonical_url, error: insertErr.message })
            );
          }
        }

        if (queueStatus === "DONE") done++;
        else if (queueStatus === "LOW_QUALITY") low_quality++;
        else partial++;

      } catch (err) {
        failed++;
        const newRetry = item.retry_count + 1;
        const newStatus = newRetry >= MAX_RETRIES ? "FAILED" : "PENDING";

        await supabase
          .from("scrape_queue")
          .update({ status: newStatus, retry_count: newRetry, last_error: err.message })
          .eq("id", item.id);

        console.error(
          JSON.stringify({ event: "scrape_error", url: item.canonical_url, retry: newRetry, error: err.message })
        );
      } finally {
        domSem.release();
        globalSem.release();
      }
    })
  );

  const summary = { items_claimed: items.length, done, partial, low_quality, failed };
  console.log(JSON.stringify({ event: "processing_complete", ...summary }));
  return summary;
}
