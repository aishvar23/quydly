// Azure Timer Function: discover
// Trigger: every 30 minutes — "0 */30 * * * *"
//
// Parses 65+ RSS feeds, canonicalises URLs, deduplicates via scrape_queue,
// inserts new rows, and sends each new URL as a message to scrape-queue.

import Parser from "rss-parser";
import { canonicalise, hashUrl } from "../lib/canonicalise.js";
import { getSupabase, getSbSender } from "../lib/clients.js";
import RSS_FEEDS from "../lib/rss-feeds.js";

const FEED_TIMEOUT_MS = 10_000;
const BATCH_SIZE      = 100;   // rows per Supabase dedup check
const FEED_BATCH_SIZE = 10;    // concurrent feed fetches

export default async function discover(context, timer) {
  if (timer.isPastDue) {
    context.log("Timer is past due — running now.");
  }

  const parser   = new Parser({ timeout: FEED_TIMEOUT_MS });
  const supabase = getSupabase();

  let feeds_attempted = 0;
  let feeds_ok        = 0;
  let feeds_failed    = 0;
  let urls_queued     = 0;
  let urls_skipped    = 0;

  // ── 1. Parse all RSS feeds in batches of FEED_BATCH_SIZE ──────────────────
  const candidates = []; // { url_hash, canonical_url, domain, category_id, authority_score, published_at, raw_url, title, summary }

  for (let i = 0; i < RSS_FEEDS.length; i += FEED_BATCH_SIZE) {
    const batch = RSS_FEEDS.slice(i, i + FEED_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (feed) => {
        feeds_attempted++;
        const parsed = await parser.parseURL(feed.url);
        feeds_ok++;
        return { feed, items: parsed.items ?? [] };
      })
    );

    for (const result of results) {
      if (result.status === "rejected") {
        feeds_failed++;
        context.log.error(JSON.stringify({
          event: "feed_error",
          error: result.reason?.message,
        }));
        continue;
      }

      const { feed, items } = result.value;

      for (const item of items) {
        const rawUrl = item.link ?? item.guid;
        if (!rawUrl) continue;

        let canonical;
        try {
          canonical = canonicalise(rawUrl);
        } catch {
          continue; // malformed URL — skip silently
        }

        const url_hash = hashUrl(canonical);

        candidates.push({
          url_hash,
          canonical_url:   canonical,
          domain:          feed.domain,
          category_id:     feed.category,
          authority_score: feed.authority_score,
          published_at:    item.isoDate ?? item.pubDate ?? null,
          title:           item.title   ?? null,
          summary:         item.contentSnippet ?? item.summary ?? null,
        });
      }
    }
  }

  // ── 2. Dedup: check which url_hashes already exist in scrape_queue ─────────
  // Process in batches to avoid IN clause limits.
  const allHashes  = candidates.map(c => c.url_hash);
  const knownHashes = new Set();

  for (let i = 0; i < allHashes.length; i += BATCH_SIZE) {
    const batchHashes = allHashes.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("scrape_queue")
      .select("url_hash")
      .in("url_hash", batchHashes);

    if (error) {
      context.log.error(JSON.stringify({ event: "dedup_check_error", error: error.message }));
      continue;
    }
    for (const row of data ?? []) {
      knownHashes.add(row.url_hash);
    }
  }

  const newCandidates = candidates.filter(c => !knownHashes.has(c.url_hash));

  // ── 3. Insert new rows into scrape_queue ──────────────────────────────────
  for (let i = 0; i < newCandidates.length; i += BATCH_SIZE) {
    const batch = newCandidates.slice(i, i + BATCH_SIZE);
    const rows  = batch.map(c => ({
      url_hash:       c.url_hash,
      canonical_url:  c.canonical_url,
      domain:         c.domain,
      category_id:    c.category_id,
      authority_score: c.authority_score,
      published_at:   c.published_at,
      status:         "PENDING",
    }));

    const { error } = await supabase
      .from("scrape_queue")
      .insert(rows, { onConflict: "url_hash", ignoreDuplicates: true });

    if (error) {
      context.log.error(JSON.stringify({ event: "insert_error", error: error.message }));
    }
  }

  // ── 4. Send new URLs to scrape-queue (Service Bus) ────────────────────────
  if (newCandidates.length > 0) {
    const sender = getSbSender("scrape-queue");
    try {
      // Send in batches that fit within SB message size limits
      for (let i = 0; i < newCandidates.length; i += BATCH_SIZE) {
        const batch = newCandidates.slice(i, i + BATCH_SIZE);
        const sbBatch = await sender.createMessageBatch();

        for (const c of batch) {
          const msg = {
            body: {
              url_hash:        c.url_hash,
              canonical_url:   c.canonical_url,
              source_domain:   c.domain,
              category_id:     c.category_id,
              authority_score: c.authority_score,
              published_at:    c.published_at,
              title:           c.title,
              summary:         c.summary,
            },
            messageId: c.url_hash,
          };

          if (!sbBatch.tryAddMessage(msg)) {
            // Batch full — send it and start a new one
            await sender.sendMessages(sbBatch);
            const nextBatch = await sender.createMessageBatch();
            nextBatch.tryAddMessage(msg);
          }
        }

        await sender.sendMessages(sbBatch);
        urls_queued += batch.length;
      }
    } finally {
      await sender.close();
    }
  }

  urls_skipped = candidates.length - newCandidates.length;

  const summary = { feeds_attempted, feeds_ok, feeds_failed, urls_queued, urls_skipped };
  context.log(JSON.stringify({ event: "discover_run", ...summary }));
}
