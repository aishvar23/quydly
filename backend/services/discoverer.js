// Phase 4.1 — Discovery service
// Fetches all RSS feeds, canonicalises URLs, inserts new items into scrape_queue.
// Idempotent: ON CONFLICT DO NOTHING means re-runs skip already-queued URLs.

import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";
import RSS_FEEDS from "../../config/rss-feeds.js";
import { canonicalise, hashUrl } from "../utils/canonicalise.js";

const BATCH_SIZE = 100; // rows per Supabase upsert batch
const FEED_TIMEOUT_MS = 10_000;

function buildSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export async function runDiscovery() {
  const parser = new Parser({ timeout: FEED_TIMEOUT_MS });
  const supabase = buildSupabase();

  let feeds_attempted = 0;
  let feeds_ok = 0;
  let feeds_failed = 0;
  let urls_queued = 0;
  let urls_skipped = 0;

  const rows = [];

  for (const feed of RSS_FEEDS) {
    feeds_attempted++;
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items ?? []) {
        const rawUrl = item.link ?? item.guid;
        if (!rawUrl) continue;

        let canonical;
        try {
          canonical = canonicalise(rawUrl);
        } catch {
          continue; // malformed URL — skip silently
        }

        const url_hash = hashUrl(canonical);
        rows.push({
          url_hash,
          canonical_url: canonical,
          domain: feed.domain,
          category_id: feed.category,
          authority_score: feed.authority_score,
          status: "PENDING",
        });
      }
      feeds_ok++;
    } catch (err) {
      feeds_failed++;
      console.error(
        JSON.stringify({ event: "feed_error", feed: feed.url, error: err.message })
      );
    }
  }

  // Batch-upsert; ignoreDuplicates skips rows with conflicting url_hash
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from("scrape_queue")
      .upsert(batch, { onConflict: "url_hash", ignoreDuplicates: true, count: "exact" });

    if (error) {
      console.error(
        JSON.stringify({ event: "insert_error", error: error.message })
      );
      continue;
    }
    urls_queued += count ?? 0;
    urls_skipped += batch.length - (count ?? 0);
  }

  const summary = { feeds_attempted, feeds_ok, feeds_failed, urls_queued, urls_skipped };
  console.log(JSON.stringify({ event: "discovery_complete", ...summary }));
  return summary;
}
