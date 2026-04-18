// Azure Service Bus Function: article-scraper
// Trigger: scrape-queue message
//
// Per-message: fetch URL, parse with Readability, write to raw_articles.
// Per-domain Redis semaphore caps concurrent scrapes at MAX_DOMAIN_CONCURRENCY=2.
// On domain cap hit: completeMessage() + scheduleMessages() 5 min out — never abandon().
//
// autoComplete: true (host.json) — return normally = complete, throw = abandon.

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { hashUrl } from "../lib/canonicalise.js";
import { getSupabase, getSbSender, getRedis } from "../lib/clients.js";

const MAX_DOMAIN_CONCURRENCY = 2;
const FETCH_TIMEOUT_MS       = 9_000;
const MIN_CONTENT_LENGTH     = 200;
const REDIS_SEMAPHORE_TTL_S  = 30;   // safety TTL — released in finally before this fires

export default async function articleScraper(context, message) {
  const {
    url_hash,
    canonical_url,
    source_domain,
    category_id,
    authority_score,
    published_at,
    title:    msg_title,
    summary:  msg_summary,
  } = message;

  const supabase = getSupabase();
  const redis    = getRedis();
  const redisKey = `domain_inflight:${source_domain}`;

  // ── 1. Per-domain Redis semaphore ─────────────────────────────────────────
  const count = await redis.incr(redisKey);
  await redis.expire(redisKey, REDIS_SEMAPHORE_TTL_S);

  if (count > MAX_DOMAIN_CONCURRENCY) {
    await redis.decr(redisKey);

    // Complete the in-flight message and re-schedule it 5 min out.
    // Explicit abandon() increments deliveryCount — we never call it for throttling.
    context.log(JSON.stringify({
      event:        "domain_throttled",
      domain:       source_domain,
      inflight:     count,
      rescheduled:  true,
    }));

    const sender = getSbSender("scrape-queue");
    try {
      await sender.scheduleMessages(
        {
          body:      message,
          messageId: url_hash,
        },
        new Date(Date.now() + 5 * 60 * 1000)
      );
    } finally {
      await sender.close();
    }
    // Return normally → runtime auto-completes original message
    return;
  }

  try {
    // ── 2. Mark PROCESSING in scrape_queue ──────────────────────────────────
    await supabase
      .from("scrape_queue")
      .update({ status: "PROCESSING" })
      .eq("url_hash", url_hash);

    // ── 3. Fetch article HTML ────────────────────────────────────────────────
    const res = await fetch(canonical_url, {
      signal:   AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept":     "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      // Non-retryable client errors (4xx except 429): complete immediately.
      // Throwing here burns the retry budget and eventually DLQs — pointless for 403/404.
      const isNonRetryable = res.status !== 429 && res.status >= 400 && res.status < 500;
      if (isNonRetryable) {
        await supabase
          .from("scrape_queue")
          .update({ status: "FAILED", last_error: `HTTP ${res.status}` })
          .eq("url_hash", url_hash)
          .then(() => {}, () => {});
        context.log(JSON.stringify({ event: "scrape_skip", url: canonical_url, http_status: res.status }));
        return; // auto-complete — no retry
      }
      throw new Error(`HTTP ${res.status} from ${canonical_url}`);
    }
    const html = await res.text();

    // ── 4. Parse with jsdom + Readability ────────────────────────────────────
    const dom     = new JSDOM(html, { url: canonical_url });
    const article = new Readability(dom.window.document).parse();

    // ── 5. Assess content quality ────────────────────────────────────────────
    const cleaned      = article?.textContent?.trim() ?? "";
    const content_hash = cleaned.length > 0 ? hashUrl(cleaned) : null;

    let final_status;
    if (!article) {
      final_status = "LOW_QUALITY";
    } else if (cleaned.length < MIN_CONTENT_LENGTH) {
      final_status = "LOW_QUALITY";
    } else {
      final_status = "DONE";
    }

    const title       = article?.title       ?? msg_title   ?? null;
    const description = article?.excerpt     ?? msg_summary  ?? null;
    const content     = cleaned.length > 0   ? cleaned      : null;
    const author      = article?.byline      ?? null;

    // ── 6. INSERT into raw_articles (idempotent) ─────────────────────────────
    if (title) {
      const { error: insertErr } = await supabase
        .from("raw_articles")
        .upsert(
          {
            url_hash,
            canonical_url,
            domain:          source_domain,
            category_id,
            title,
            description,
            content,
            content_hash,
            author,
            published_at:    published_at ?? null,
            authority_score: authority_score ?? 0,
            status:          final_status,
            is_verified:     false,
            // clustered_at intentionally null — set by article-clusterer
          },
          { onConflict: "url_hash", ignoreDuplicates: true }
        );

      if (insertErr) {
        context.log.error(JSON.stringify({
          event: "article_insert_error",
          url:   canonical_url,
          error: insertErr.message,
        }));
      }
    }

    // ── 7. Update scrape_queue status ────────────────────────────────────────
    await supabase
      .from("scrape_queue")
      .update({ status: final_status, processed_at: new Date().toISOString() })
      .eq("url_hash", url_hash);

    context.log(JSON.stringify({
      event:  "article_scraped",
      url:    canonical_url,
      status: final_status,
    }));

    // Return normally → runtime auto-completes the SB message

  } catch (err) {
    // Update scrape_queue to FAILED so the audit row reflects the error
    await supabase
      .from("scrape_queue")
      .update({ status: "FAILED", last_error: err.message })
      .eq("url_hash", url_hash)
      .then(() => {}, () => {}); // best-effort — don't mask the original throw

    context.log.error(JSON.stringify({
      event: "scrape_error",
      url:   canonical_url,
      error: err.message,
    }));

    // Re-throw so SB retries (up to maxDeliveryCount=5 before dead-lettering)
    throw err;
  } finally {
    // ── 8. Always release the domain semaphore ───────────────────────────────
    await redis.decr(redisKey).catch(() => {});
  }
}
