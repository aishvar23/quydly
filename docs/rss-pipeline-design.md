# Design Document: RSS Crawl Pipeline

**Feature:** Replace NewsData.io API with a self-hosted RSS crawl + article scrape pipeline
**Branch:** `feature/rss-crawl-pipeline`
**Status:** Design v2 — revised per architecture review
**Authors:** Aishvarya Suhane

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Problem Statement](#2-problem-statement)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Data Model](#5-data-model)
6. [Component Design](#6-component-design)
7. [Observability](#7-observability)
8. [Product Safety](#8-product-safety)
9. [Drawbacks & Concerns](#9-drawbacks--concerns)
10. [Out of Scope for MVP](#10-out-of-scope-for-mvp)
11. [Open Questions](#11-open-questions)

---

## 1. Current State

### What Quydly Is

A daily news quiz. 5 questions per session, resets at 7AM UTC. Wordle-style ritual — users feel informed, not tested. Points, streaks, global rank.

### Current Content Pipeline

```
7:00 AM UTC
     │
     ▼
generateDaily.js  (Vercel Cron)
     │
     ├─ for each category in EDITORIAL_MIX (world×2, tech×1, finance×1, culture×1)
     │         │
     │         ▼
     │   newsdata.js → GET https://newsdata.io/api/1/news
     │                      ?apikey=...&language=en&category={tag}
     │                      Returns: { title, description }
     │         │
     │         ▼
     │   claude.js → claude-sonnet-4-20250514
     │               Returns: { question, options[4], correctIndex, tldr, categoryId }
     │
     ▼
Redis (primary cache)  →  Supabase daily_questions (fallback)
     │
     ▼
GET /api/questions → app
```

### Current Limitations

| Limitation | Impact |
|-----------|--------|
| Paid API — cost scales with usage | Ongoing cost, rate limit risk |
| Headline + 1-sentence snippet only | Claude gets thin context → generic questions |
| No source verification | Single API decides what's "top news" |
| Single point of failure | NewsData.io down at 7AM = quiz fails |
| No content quality control | No way to filter low-quality or partial articles |

---

## 2. Problem Statement

NewsData.io gives us a headline and a snippet. Claude can only write as good a question as the context it receives. A 1-sentence RSS description isn't much. We also have no control over source quality, no deduplication, and an ongoing API cost for data that is freely available.

**Goals:**

1. **Zero cost** — replace paid API with free public RSS feeds
2. **Richer context** — give Claude full cleaned article body, not just a headline
3. **Source control** — we curate the publisher registry with authority scores
4. **Idempotent pipeline** — safe to retry any step without duplicate data
5. **Resilience** — no single API dependency for 7AM generation
6. **Quality gate** — only verified, non-partial, above-threshold articles reach quiz generation

---

## 3. Proposed Architecture

### Overview: Two-Phase Queue Model

The pipeline splits into two independent phases with a durable queue between them. The discovery cron does no scraping — it only finds URLs. Scraping is handled by a separate worker function that processes one URL per job.

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1 — DISCOVERY  (every 30 min, lightweight)               │
│                                                                  │
│  RSS Registry (65+ feeds, curated, authority-scored)            │
│       │                                                          │
│       ▼  rss-parser, parallel batches of 10                     │
│  For each feed item:                                             │
│    1. canonicalise URL (strip utm_*, normalise host/scheme)      │
│    2. url_hash = SHA256(canonical_url)                           │
│    3. INSERT INTO scrape_queue ON CONFLICT(url_hash) DO NOTHING  │
│                                                                  │
│  Output: new URLs queued, duplicates silently skipped           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │ scrape_queue │  (Supabase table)
                      │              │
                      │ status:      │
                      │  PENDING     │
                      │  PROCESSING  │
                      │  DONE        │
                      │  PARTIAL     │
                      │  FAILED      │
                      │  LOW_QUALITY │
                      └──────┬───────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  PHASE 2 — PROCESSING  (every 5 min, worker)                    │
│                                                                  │
│  SELECT PENDING items, up to 50                                  │
│  Respect concurrency: global cap=8, per-domain cap=2            │
│                                                                  │
│  For each URL (parallel, within caps):                           │
│    1. UPDATE status = PROCESSING                                 │
│    2. fetch(canonical_url, { timeout: 9s, UA: QuydlyBot })      │
│    3. Parse with @mozilla/readability + jsdom                    │
│    4. content_hash = SHA256(cleaned_text)                       │
│    5. Check content length:                                      │
│         < MIN_CONTENT_LENGTH → status = LOW_QUALITY             │
│    6. INSERT INTO raw_articles ON CONFLICT(url_hash) DO NOTHING  │
│    7. UPDATE scrape_queue status = DONE | PARTIAL | FAILED       │
│                                                                  │
│  On parse failure:                                               │
│    store metadata, increment retry_count                         │
│    if retry_count < MAX_RETRIES → status = PENDING (re-queued)  │
│    else → status = FAILED                                        │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │ raw_articles │  (Supabase table)
                      │              │
                      │ is_verified  │ ← manual gate (first 2 weeks)
                      │ = false      │
                      └──────┬───────┘
                             │  Human reviews + sets is_verified = true
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  QUIZ GENERATION  (7:00 AM UTC, existing cron, 2-line change)   │
│                                                                  │
│  articleStore.fetchStoriesForCategory(categoryId)               │
│    → SELECT FROM raw_articles                                    │
│      WHERE category_id = ?                                       │
│        AND is_verified = true                                    │
│        AND status = 'DONE'                                       │
│        AND published_at > NOW() - INTERVAL '48 hours'           │
│      ORDER BY authority_score DESC, published_at DESC           │
│      LIMIT 1                                                     │
│    → { title, description: content.slice(0, 500) }              │
│                                                                  │
│  generateDaily.js  →  claude.js  (both untouched)               │
└─────────────────────────────────────────────────────────────────┘
```

### Cron Schedule

| Function | Path | Schedule | Purpose |
|----------|------|----------|---------|
| Discovery | `/api/cron/discover` | `*/30 * * * *` | RSS fetch → queue new URLs |
| Processing | `/api/cron/process` | `*/5 * * * *` | Scrape queued URLs → raw_articles |
| Generation | `/api/cron/generate` | `0 7 * * *` | Existing — unchanged |
| Cleanup | `/api/cron/cleanup` | `0 3 * * *` | Delete raw_articles older than 7 days |

### What Changes vs. What Stays the Same

| Component | Status | Notes |
|-----------|--------|-------|
| `backend/services/newsdata.js` | Deleted after cutover | Replaced by `articleStore.js` |
| `backend/jobs/generateDaily.js` | 2-line change | Swap import + call site only |
| `backend/services/claude.js` | **Untouched** | Same prompt, same interface |
| `api/questions.js` | **Untouched** | |
| `api/complete.js` | **Untouched** | |
| Redis/Supabase question cache | **Untouched** | |
| `config/categories.js` | `newsDataTag` unused | Left in place, harmless |

---

## 4. Tech Stack

### New Dependencies

| Package | Purpose | Replaces |
|---------|---------|---------|
| `rss-parser` | RSS/Atom feed parsing | — |
| `@mozilla/readability` | Semantic article text extraction | cheerio selector guessing |
| `jsdom` | DOM environment for Readability | — |

### Why `@mozilla/readability` over cheerio?

Cheerio requires us to guess CSS selectors per publisher (`article`, `[class*="article-body"]`, etc.). This is brittle — publishers change their markup. Readability uses the same algorithm as Firefox Reader View: it analyses paragraph density across the DOM and extracts the main content node automatically. It works across publishers without hardcoded selectors. Tradeoff: requires `jsdom` for a DOM environment (~a few MB of overhead on the Lambda, acceptable).

### Why Not Puppeteer / Playwright?

Headless browsers (~150MB Chromium) exceed Vercel's 50MB unzipped function limit without the `@sparticuz/chromium` shim. They add cold-start latency and cost. For major news publishers (BBC, Reuters, AP, Guardian), the article is in plain HTML — no JavaScript rendering required. Publishers that require JS rendering (rare) are behind paywalls anyway, inaccessible to any unauthenticated scraper.

### Why Not Newspaper3k?

Python-only. Our backend is Node.js ESM. Adding a Python Vercel Function creates a separate runtime and inter-service HTTP calls for no meaningful benefit.

### Queue Infrastructure

**Choice: Supabase `scrape_queue` table (not Redis, not external queue)**

| Option | Pro | Con |
|--------|-----|-----|
| Supabase table | Durable, reprocessable, visible, no new infra | Slightly slower than in-memory |
| Redis list | Fast | Ephemeral without persistence, no reprocess visibility |
| Vercel Queues | Platform-native | Public beta, uncertain API stability |

Supabase wins because durability and reprocessing (`UPDATE status = 'PENDING'`) are first-class requirements.

### Full Stack After Migration

| Layer | Technology |
|-------|-----------|
| Frontend | React Native (Expo) |
| Backend API | Node.js + Express (Vercel Functions) |
| **Discovery cron** | **rss-parser + Vercel Cron (every 30 min)** |
| **Processing worker** | **@mozilla/readability + jsdom + Vercel Cron (every 5 min)** |
| **Job queue** | **Supabase `scrape_queue` table** |
| **Article store** | **Supabase `raw_articles` table** |
| AI | Claude API (`claude-sonnet-4-20250514`) |
| Question cache | Redis + Supabase `daily_questions` |
| Auth | Supabase Auth |
| Email | Resend |
| Payments | Stripe (stub) |
| Deploy | Vercel |

---

## 5. Data Model

### Table: `scrape_queue`

The durable job queue. Discovery writes here. Processing reads from here.

```sql
CREATE TABLE IF NOT EXISTS scrape_queue (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash       text        UNIQUE NOT NULL,
  -- SHA256(canonical_url) — idempotency key

  canonical_url  text        NOT NULL,
  -- Normalised URL: https, lowercase host, no trailing slash, no tracking params

  raw_url        text        NOT NULL,
  -- Original URL from RSS feed (preserved for debugging)

  title          text,
  summary        text,
  -- From RSS — stored immediately so we have metadata even if scrape fails

  source_domain  text        NOT NULL,
  -- e.g. "bbc.com" — used for per-domain rate limiting

  category_id    text        NOT NULL,
  -- world | tech | finance | culture | science

  authority_score float      NOT NULL DEFAULT 1.0,
  -- From rss-feeds.js registry entry. Copied here at discovery time.

  published_at   timestamptz,
  -- From RSS <pubDate>

  status         text        NOT NULL DEFAULT 'PENDING',
  -- PENDING | PROCESSING | DONE | PARTIAL | FAILED | LOW_QUALITY

  retry_count    int         NOT NULL DEFAULT 0,
  last_error     text,
  -- Last failure reason (for debugging, failure sampling)

  discovered_at  timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_scrape_queue_status_discovered
  ON scrape_queue (status, discovered_at ASC);
  -- Primary worker query path: fetch PENDING ordered by age

CREATE INDEX IF NOT EXISTS idx_scrape_queue_domain_status
  ON scrape_queue (source_domain, status);
  -- Per-domain concurrency cap enforcement
```

**Status lifecycle:**

```
PENDING → PROCESSING → DONE
                    ↘ PARTIAL      (fetch ok, parse failed — has metadata, no content)
                    ↘ LOW_QUALITY  (content below MIN_CONTENT_LENGTH threshold)
                    ↘ FAILED       (retry_count >= MAX_RETRIES)
PARTIAL/FAILED → PENDING           (manual reprocess: UPDATE status='PENDING')
```

---

### Table: `raw_articles`

Cleaned, deduplicated, ready-to-use articles. Only `DONE` + `is_verified = true` rows reach quiz generation.

```sql
CREATE TABLE IF NOT EXISTS raw_articles (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  url_hash       text        UNIQUE NOT NULL,
  -- SHA256(canonical_url) — same key as scrape_queue

  canonical_url  text        NOT NULL,

  title          text        NOT NULL,

  content        text,
  -- Cleaned article text from @mozilla/readability
  -- NULL only if scrape_queue status = PARTIAL

  content_hash   text,
  -- SHA256(content) — detect duplicate content from different URLs
  -- NULL if content is NULL

  source_domain  text        NOT NULL,
  category_id    text        NOT NULL,

  authority_score float      NOT NULL DEFAULT 1.0,
  -- Copied from rss-feeds.js at ingest time

  status         text        NOT NULL DEFAULT 'DONE',
  -- DONE | PARTIAL | LOW_QUALITY

  is_verified    boolean     NOT NULL DEFAULT false,
  -- Manual gate: must be true for article to reach quiz generation
  -- Required for first 2 weeks; automated verification TBD

  published_at   timestamptz,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_articles_quiz_ready
  ON raw_articles (category_id, published_at DESC)
  WHERE is_verified = true AND status = 'DONE';
  -- Partial index: only rows eligible for quiz generation

CREATE INDEX IF NOT EXISTS idx_raw_articles_content_hash
  ON raw_articles (content_hash)
  WHERE content_hash IS NOT NULL;
  -- Detect duplicate content from different URLs

CREATE INDEX IF NOT EXISTS idx_raw_articles_cleanup
  ON raw_articles (ingested_at);
  -- Cleanup cron: DELETE WHERE ingested_at < NOW() - INTERVAL '7 days'
```

---

### URL Canonicalization Rules

Applied to every URL at discovery time before computing `url_hash`.

```
1. Parse URL
2. Force scheme to https
3. Lowercase hostname
4. Remove trailing slash from path (unless path is "/")
5. Remove tracking query parameters:
     utm_source, utm_medium, utm_campaign, utm_content, utm_term
     ref, source, campaign
     fbclid, gclid, dclid
     mc_cid, mc_eid
     (pattern: /^(utm_|mc_|fb|g)clid/i)
6. Sort remaining query parameters alphabetically (deterministic)
7. Remove URL fragment (#...)
8. Result: canonical_url
9. url_hash = SHA256(canonical_url)
```

Example:
```
Input:  https://www.bbc.com/news/world-123?utm_source=rss&utm_medium=rss#top
Output: https://www.bbc.com/news/world-123
Hash:   SHA256("https://www.bbc.com/news/world-123")
```

---

### Content Hash Logic

```
1. cleaned_text = Readability output (article.textContent, whitespace normalised)
2. content_hash = SHA256(cleaned_text)
```

Used to detect duplicate content published under different URLs (syndicated stories). If `content_hash` already exists in `raw_articles`, the new row is still inserted (different `url_hash`, different source — this is useful for triangulation in v2) but the `content_hash` index makes duplicates detectable.

---

### Low-Quality Filter

```
MIN_CONTENT_LENGTH = 200  (characters of cleaned text)

if (content.length < MIN_CONTENT_LENGTH) {
  status = 'LOW_QUALITY'
  // stored in raw_articles but excluded from quiz generation
}
```

A 200-char threshold filters login walls, "subscribe to read" pages, and RSS-only stub entries while allowing genuinely short news items through for manual review.

---

### Feed Registry Schema (`config/rss-feeds.js`)

```js
{
  url: string,           // RSS feed URL
  domain: string,        // e.g. "bbc.com"
  category: string,      // world | tech | finance | culture | science
  authority_score: float // 0.0–1.0, used for article ranking
                         // 1.0 = wire services (Reuters, AP)
                         // 0.8 = major broadsheets (NYT, Guardian, BBC)
                         // 0.6 = specialist/trade publications
                         // 0.4 = aggregators, secondary sources
}
```

---

## 6. Component Design

### `api/cron/discover.js` — Discovery Cron (every 30 min)

```
Input:  none (reads RSS_FEEDS from config)
Output: { feeds_attempted, feeds_ok, feeds_failed, urls_queued, urls_skipped }

Algorithm:
  1. Fetch all feeds: Promise.allSettled in batches of 10
  2. For each item in each feed:
     a. canonicaliseUrl(item.link) → canonical_url
     b. url_hash = SHA256(canonical_url)
     c. INSERT INTO scrape_queue
          (url_hash, canonical_url, raw_url, title, summary,
           source_domain, category_id, authority_score, published_at)
        ON CONFLICT (url_hash) DO NOTHING
     d. if inserted → urls_queued++; else → urls_skipped++
  3. Log structured metrics (see Observability)
  4. Return summary

Error handling:
  - Per-feed errors are caught individually — one broken feed never stops the run
  - Feed-level failures are logged with feed URL and error message
  - Failed feeds sampled to scrape_queue.last_error for debugging
```

### `api/cron/process.js` — Processing Worker (every 5 min)

```
Input:  none (reads from scrape_queue)
Output: { processed, done, partial, low_quality, failed }

Algorithm:
  1. SELECT id, canonical_url, url_hash, source_domain, category_id,
            title, summary, authority_score, published_at
     FROM scrape_queue
     WHERE status = 'PENDING'
     ORDER BY discovered_at ASC
     LIMIT 50
     FOR UPDATE SKIP LOCKED
     -- SKIP LOCKED: safe for concurrent invocations if they overlap

  2. UPDATE scrape_queue SET status = 'PROCESSING' for selected rows

  3. Apply concurrency caps:
     - Global cap: 8 simultaneous scrapes (p-limit)
     - Per-domain cap: 2 simultaneous per source_domain
     Group selected rows: sort, assign slots respecting both caps

  4. For each URL (parallel, within caps):
     a. fetch(canonical_url, { signal: AbortSignal.timeout(9000),
             headers: { 'User-Agent': 'QuydlyBot/1.0 (+https://quydly.com/bot)' }})
     b. If non-200:
          increment retry_count
          if retry_count < MAX_RETRIES(3) → set status = PENDING
          else → set status = FAILED, store last_error
          continue
     c. Parse HTML with jsdom:
          const dom = new JSDOM(html, { url: canonical_url })
     d. Extract with Readability:
          const reader = new Readability(dom.window.document)
          const article = reader.parse()
     e. cleaned = article?.textContent?.trim() ?? null
     f. if !cleaned or cleaned.length < MIN_CONTENT_LENGTH(200):
          determine status: PARTIAL (null) or LOW_QUALITY (too short)
     g. content_hash = cleaned ? SHA256(cleaned) : null
     h. INSERT INTO raw_articles
          (url_hash, canonical_url, title, content, content_hash,
           source_domain, category_id, authority_score, status,
           is_verified=false, published_at)
        ON CONFLICT (url_hash) DO NOTHING
     i. UPDATE scrape_queue SET status = final_status, processed_at = now()

  5. Return summary metrics

Error handling:
  - Per-URL errors (network, parse, DB) are isolated — never abort the batch
  - Errors stored in scrape_queue.last_error for failure sampling
  - Retry budget: MAX_RETRIES = 3
```

### `backend/services/articleStore.js` — Article Store (replaces newsdata.js)

```
Input:  categoryId (string)
Output: { title: string, description: string }

Algorithm:
  1. SELECT title, content, summary
     FROM raw_articles
     WHERE category_id = $categoryId
       AND is_verified = true
       AND status = 'DONE'
       AND published_at > NOW() - INTERVAL '48 hours'
     ORDER BY authority_score DESC, published_at DESC
     LIMIT 10

  2. If results empty → throw "No verified articles for category in 48h"
     (generateDaily catches this; fallback: use newsdata.js until cutover confirmed)

  3. Pick randomly from top-5 results (avoid always using same top article)

  4. Return {
       title: article.title,
       description: (article.content ?? article.summary ?? "").slice(0, 500)
     }

Interface: identical to fetchHeadline() in newsdata.js
```

### `api/cron/cleanup.js` — Cleanup Cron (daily at 3AM)

```sql
-- Delete articles older than 7 days
DELETE FROM raw_articles WHERE ingested_at < NOW() - INTERVAL '7 days';
DELETE FROM scrape_queue WHERE discovered_at < NOW() - INTERVAL '7 days'
  AND status IN ('DONE', 'LOW_QUALITY', 'FAILED');
-- Keep PENDING/PARTIAL for manual inspection
```

### Modified `backend/jobs/generateDaily.js`

Two lines change. Everything else is identical.

```js
// Line 11 — before:
import { fetchHeadline } from "../services/newsdata.js";
// Line 11 — after:
import { fetchStoriesForCategory } from "../services/articleStore.js";

// Line 73 — before:
const headline = await fetchHeadline(category.newsDataTag);
// Line 73 — after:
const headline = await fetchStoriesForCategory(category.id);
```

---

## 7. Observability

### Structured Metrics (logged per cron run)

Each cron function logs one JSON object at completion. These are queryable in Vercel log drains.

**Discovery cron:**
```json
{
  "event": "discover_run",
  "timestamp": "2026-04-09T10:30:00Z",
  "feeds_attempted": 65,
  "feeds_ok": 63,
  "feeds_failed": 2,
  "urls_discovered": 247,
  "urls_queued": 12,
  "urls_skipped": 235,
  "failed_feeds": ["https://example.com/rss"]
}
```

**Processing cron:**
```json
{
  "event": "process_run",
  "timestamp": "2026-04-09T10:35:00Z",
  "batch_size": 12,
  "done": 9,
  "partial": 1,
  "low_quality": 1,
  "failed": 1,
  "scrape_success_rate": 0.75,
  "avg_content_length": 2840
}
```

**Key metrics to watch:**
| Metric | Formula | Alert threshold |
|--------|---------|----------------|
| Feed success rate | `feeds_ok / feeds_attempted` | < 0.85 for 3 consecutive runs |
| Scrape success rate | `done / batch_size` | < 0.60 for 3 consecutive runs |
| Dedup rate | `urls_skipped / urls_discovered` | — (informational) |
| Queue depth | `SELECT COUNT(*) FROM scrape_queue WHERE status='PENDING'` | > 500 (processing falling behind) |

### Failure Sampling

Failed scrape payloads are stored in `scrape_queue.last_error` (text). For HTTP errors, also store status code. This provides a debugging corpus without a separate error store.

Example stored in `last_error`:
```
fetch_error: 403 Forbidden (attempted 3 times)
```
```
parse_error: Readability returned null — likely a login wall
```

### Reprocessing

To retry failed articles:
```sql
-- Retry all FAILED items (resets retry counter)
UPDATE scrape_queue
SET status = 'PENDING', retry_count = 0, last_error = NULL
WHERE status = 'FAILED';

-- Retry specific domain
UPDATE scrape_queue
SET status = 'PENDING', retry_count = 0
WHERE status = 'FAILED' AND source_domain = 'bloomberg.com';

-- Reprocess LOW_QUALITY (e.g. after raising threshold)
UPDATE raw_articles SET status = 'PENDING' WHERE status = 'LOW_QUALITY';
-- (process.js would need to re-read from raw_articles for this — alternatively
--  update scrape_queue status = 'PENDING' for same url_hashes)
```

---

## 8. Product Safety

### Manual Verification Gate

All newly ingested articles enter `raw_articles` with `is_verified = false`. They are invisible to quiz generation until a human sets `is_verified = true`.

**Required for: first 2 weeks of operation.**

During this period:
1. Run discovery + processing crns in shadow mode (not wired to generateDaily)
2. Review `raw_articles` in Supabase dashboard daily
3. Check: is content clean? is it actually news? is it category-appropriate?
4. Bulk-approve trusted sources:
   ```sql
   -- Approve all DONE articles from wire services
   UPDATE raw_articles SET is_verified = true
   WHERE source_domain IN ('reuters.com', 'apnews.com', 'bbc.com')
     AND status = 'DONE';
   ```
5. After 2 weeks, move to automated verification (approve all DONE + authority_score ≥ 0.8)

### Source Authority Scoring

Each feed in `config/rss-feeds.js` carries an `authority_score` (0.0–1.0):

| Score | Publisher tier | Examples |
|-------|---------------|---------|
| 1.0 | International wire services | Reuters, AP |
| 0.8 | Major broadsheets + broadcasters | BBC, NYT, Guardian, FT, WaPo |
| 0.6 | Quality specialist / trade | Ars Technica, Wired, Nature, Economist |
| 0.4 | Secondary / aggregator | Engadget, ZDNet, ScienceDaily |

`authority_score` is stored on each article at ingest time and used for:
- Ordering results in `articleStore` (higher authority = preferred)
- Future: filtering threshold (e.g. only quiz on articles from sources ≥ 0.6)
- Future: triangulation weighting (3 wire-service sources > 5 aggregator sources)

### Category-Aware Prompting

*Deferred from MVP.* The claude.js prompt is currently category-aware only through the `categoryId` field passed to Claude. Future: inject category-specific tone guidance (finance = precise/sober; culture = playful; science = curious) into the system prompt. Structure defined, implementation optional in MVP.

---

## 9. Drawbacks & Concerns

### 9.1 Processing Cron Throughput

**Problem:** The processing cron runs every 5 minutes and processes up to 50 URLs per run. At 8 concurrent scrapes with ~2s average per scrape, one run takes ~13s for 50 URLs. This is fine. However, if the queue grows faster than it drains (e.g., after adding many new feeds), backpressure builds.

**Mitigation:**
- Monitor queue depth (`SELECT COUNT(*) WHERE status='PENDING'`)
- `FOR UPDATE SKIP LOCKED` allows multiple processing invocations to run safely in parallel if needed
- Alert threshold: queue depth > 500

### 9.2 Paywall Scraping (~20% of sources)

**Problem:** Bloomberg, FT, NYT, Economist return login walls. Readability will extract "Subscribe to read" text, which gets flagged as LOW_QUALITY (too short) or PARTIAL.

**Mitigation:**
- These sources still contribute `title` + `summary` from RSS (stored at discovery time)
- `is_verified = true` can be set on PARTIAL rows manually if the title alone is sufficient for a good question
- Wire services (Reuters, AP, BBC — all open) cover every major story

### 9.3 jsdom Memory Footprint

**Problem:** `jsdom` is a full DOM implementation. Instantiating it per article adds ~20-30MB of memory per concurrent execution. At 8 concurrent scrapes, peak memory could hit ~250MB.

**Mitigation:**
- Vercel Functions default to 1024MB on Pro — well within budget
- `jsdom` instances are not retained between articles (GC'd after each parse)
- Alternative if memory becomes an issue: `linkedom` as a lighter JSDOM drop-in (but Readability compatibility is partial)

### 9.4 Bootstrap / Day-One Problem

**Problem:** `raw_articles` is empty on first deploy. `generateDaily` at 7AM will find no verified articles → throw → quiz generation fails.

**Required sequence before cutover:**
1. Deploy discovery + processing crns without modifying `generateDaily.js`
2. Wait 24h for articles to accumulate
3. Manually verify first batch (`is_verified = true` for trusted sources)
4. Confirm `articleStore` returns results for all 4 categories in EDITORIAL_MIX
5. Only then apply the 2-line change to `generateDaily.js`
6. Keep `NEWSDATA_API_KEY` in env as instant rollback for 1 week post-cutover

### 9.5 Vercel Cron Reliability

**Problem:** Vercel Crons are best-effort on Hobby plan — they can be skipped under load. Missing a 30-min discovery cycle means slightly stale queue, but not catastrophic (articles from prior cycles are still valid).

**Mitigation:**
- On Pro plan, crons are more reliable
- The 48-hour window in `articleStore` gives ample buffer — missing one or two discovery cycles doesn't affect quiz generation
- The cleanup cron uses a 7-day TTL — missing one daily cleanup is harmless

### 9.6 robots.txt / Legal

**Problem:** Some publishers may prohibit crawling.

**Mitigation:**
- `User-Agent: QuydlyBot/1.0` is honest self-identification
- We respect non-200 HTTP responses without retry-hammering
- RSS feeds are explicitly published for syndication — fetching them is the intended use
- We extract ≤500 chars for LLM context (educational/transformative use)
- Per-domain cap of 2 simultaneous requests prevents scraping at scale
- Removing a publisher = delete their feeds from `rss-feeds.js`

---

## 10. Out of Scope for MVP

| Feature | Rationale for deferral |
|---------|----------------------|
| Jaccard / embedding-based story clustering | Adds O(k) complexity per insert; no quiz-side benefit until triangulation is reintroduced in v2 |
| Triangulation gate (≥3 sources) | Requires clustering; deferred with clustering |
| `content_hash` dedup enforcement | Detected (indexed) but not blocked in MVP — duplicate content reaches the DB, is_verified gate is the quality control |
| Automated `is_verified` promotion | Manual gate for first 2 weeks; automate after trust is established |
| Category-aware Claude prompting | Structure in place; implementation optional |
| Readability language detection | Out of scope — all feeds are English |
| Sitemap / full-site crawl | RSS-only in MVP; sitemap crawling is future expansion |

---

## 11. Open Questions

| # | Question | Impact | Decision by |
|---|----------|--------|------------|
| Q1 | MIN_CONTENT_LENGTH: 200 chars — right threshold? | Affects LOW_QUALITY rate | Set at implementation, tune after 1 week of data |
| Q2 | MAX_RETRIES: 3 — sufficient for transient failures? | Affects FAILED rate | Confirm at implementation |
| Q3 | 7-day TTL: right retention window? | Storage cost vs. lookback range | Review at 1 month |
| Q4 | Who performs manual verification in the first 2 weeks? | Ops dependency | Designate before go-live |
| Q5 | Should `science` category be added to EDITORIAL_MIX? | Quiz variety | Separate product decision, not blocked |

---

## Summary

| Dimension | Current | Proposed MVP |
|-----------|---------|-------------|
| News source | Paid API (NewsData.io) | Free public RSS (65+ feeds) |
| Article context | Headline + snippet | Full cleaned body (Readability) |
| Story verification | None | Manual `is_verified` gate (2 weeks) |
| Pipeline model | Single synchronous cron | Decoupled discover → queue → worker |
| Idempotency | None | SHA256(canonical_url), ON CONFLICT DO NOTHING |
| Content quality | Unfiltered | LOW_QUALITY filter + PARTIAL status |
| Failure handling | Throw → fail | Retry budget, status tracking, reprocessing |
| Source ranking | None | `authority_score` per feed |
| Clustering | N/A | **Deferred to v2** |
| Triangulation | N/A | **Deferred to v2** |
| Observability | None | Structured metrics per run, failure sampling |
| Cost | Paid tier | $0 (existing Vercel + Supabase) |
