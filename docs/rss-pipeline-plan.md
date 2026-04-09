# Plan: Replace NewsData.io with Self-Hosted RSS Crawl Pipeline

> **v2 — aligned with design doc and tracker**
> Full design: `docs/rss-pipeline-design.md` | Tracker: `RSS_PIPELINE.md`

## Context

Quydly currently pays for NewsData.io to source article headlines. The goal is to replace this with a free, self-hosted RSS crawl pipeline. The pipeline splits into two independent phases with a durable Supabase queue between them — a discovery cron that only finds URLs, and a processing worker that scrapes and cleans each article individually using `@mozilla/readability`.

The existing `fetchHeadline()` contract (`→ {title, description}`) is preserved end-to-end. `claude.js` and the quiz generation pipeline are untouched.

**Key decisions locked in:**
- Jaccard similarity / story clustering → **deferred to v2**
- cheerio → **replaced by `@mozilla/readability + jsdom`**
- Monolithic ingest cron → **split into discover (30 min) + process (5 min)**
- Dedup strategy → **SHA256(canonical_url) + ON CONFLICT DO NOTHING only**
- Manual `is_verified` gate → **required for first 2 weeks**

---

## Architecture

```
RSS Registry (65+ feeds, authority-scored)
        ↓  every 30 min — api/cron/discover.js
  discoverer.js
    ├─ canonicalise URL → SHA256(url_hash)
    └─ INSERT INTO scrape_queue ON CONFLICT DO NOTHING

        ↓  durable queue
  scrape_queue (Supabase)
  status: PENDING → PROCESSING → DONE | PARTIAL | LOW_QUALITY | FAILED

        ↓  every 5 min — api/cron/process.js
  processor.js  (global cap=8, per-domain cap=2)
    ├─ fetch article HTML
    ├─ @mozilla/readability → cleaned text
    ├─ content_hash = SHA256(cleaned_text)
    ├─ LOW_QUALITY if content < 200 chars
    ├─ retry_count++ on failure (MAX_RETRIES=3)
    └─ INSERT INTO raw_articles (is_verified=false) ON CONFLICT DO NOTHING

        ↓  manual review (first 2 weeks)
  raw_articles (Supabase) — is_verified = true for trusted sources

        ↓  7AM cron — generateDaily.js (2-line change only)
  articleStore.fetchStoriesForCategory(categoryId)
    → WHERE is_verified=true AND status='DONE' AND published_at > 48h ago
    → ORDER BY authority_score DESC, published_at DESC
    → { title, description: content.slice(0, 500) }

        ↓  unchanged
  claude.js → quiz question
```

---

## Cron Schedule

| Cron | Path | Schedule | Purpose |
|------|------|----------|---------|
| Discovery | `/api/cron/discover` | `*/30 * * * *` | RSS fetch → queue new URLs |
| Processing | `/api/cron/process` | `*/5 * * * *` | Scrape queued URLs → raw_articles |
| Generation | `/api/cron/generate` | `0 7 * * *` | Existing — unchanged |
| Cleanup | `/api/cron/cleanup` | `0 3 * * *` | 7-day TTL delete |

---

## New Dependencies

```
npm install rss-parser @mozilla/readability jsdom
```

- `rss-parser` — RSS/Atom feed parsing
- `@mozilla/readability` — semantic article extraction (same algorithm as Firefox Reader View)
- `jsdom` — DOM environment required by Readability

---

## Database Schema

### `scrape_queue`

```sql
CREATE TABLE IF NOT EXISTS scrape_queue (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash       text        UNIQUE NOT NULL,       -- SHA256(canonical_url)
  canonical_url  text        NOT NULL,
  raw_url        text        NOT NULL,
  title          text,
  summary        text,
  source_domain  text        NOT NULL,
  category_id    text        NOT NULL,
  authority_score float      NOT NULL DEFAULT 1.0,
  published_at   timestamptz,
  status         text        NOT NULL DEFAULT 'PENDING',
  -- PENDING | PROCESSING | DONE | PARTIAL | FAILED | LOW_QUALITY
  retry_count    int         NOT NULL DEFAULT 0,
  last_error     text,
  discovered_at  timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

CREATE INDEX idx_scrape_queue_status_discovered ON scrape_queue (status, discovered_at ASC);
CREATE INDEX idx_scrape_queue_domain_status ON scrape_queue (source_domain, status);
```

### `raw_articles`

```sql
CREATE TABLE IF NOT EXISTS raw_articles (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash       text        UNIQUE NOT NULL,       -- SHA256(canonical_url)
  canonical_url  text        NOT NULL,
  title          text        NOT NULL,
  content        text,                              -- cleaned text from Readability
  content_hash   text,                              -- SHA256(content)
  source_domain  text        NOT NULL,
  category_id    text        NOT NULL,
  authority_score float      NOT NULL DEFAULT 1.0,
  status         text        NOT NULL DEFAULT 'DONE',
  -- DONE | PARTIAL | LOW_QUALITY
  is_verified    boolean     NOT NULL DEFAULT false,
  published_at   timestamptz,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_raw_articles_quiz_ready ON raw_articles (category_id, published_at DESC)
  WHERE is_verified = true AND status = 'DONE';
CREATE INDEX idx_raw_articles_content_hash ON raw_articles (content_hash)
  WHERE content_hash IS NOT NULL;
CREATE INDEX idx_raw_articles_cleanup ON raw_articles (ingested_at);
```

---

## URL Canonicalization (`backend/utils/canonicalise.js`)

```
1. Force scheme → https
2. Lowercase hostname
3. Remove trailing slash from path
4. Strip params: utm_*, ref, source, campaign, fbclid, gclid, mc_*
5. Sort remaining params alphabetically
6. Remove fragment
7. url_hash = SHA256(canonical_url)
```

---

## File Inventory

| Action | File | Phase |
|--------|------|-------|
| CREATE | `backend/db/migration_scrape_queue.sql` | 1 |
| CREATE | `backend/db/migration_raw_articles.sql` | 1 |
| CREATE | `config/rss-feeds.js` | 2 |
| CREATE | `backend/utils/canonicalise.js` | 3 |
| CREATE | `backend/services/discoverer.js` | 4 |
| CREATE | `api/cron/discover.js` | 4 |
| CREATE | `backend/services/scraper.js` | 5 |
| CREATE | `backend/services/processor.js` | 5 |
| CREATE | `api/cron/process.js` | 5 |
| CREATE | `backend/services/articleStore.js` | 6 |
| CREATE | `api/cron/cleanup.js` | 7 |
| MODIFY | `backend/jobs/generateDaily.js` line 11 + 73 | 8 |
| MODIFY | `vercel.json` — 3 new crons + maxDuration | 4/5/7 |
| DELETE | `backend/services/newsdata.js` | 10 |
| MODIFY | `config/categories.js` — remove newsDataTag | 10 |
| NO TOUCH | `backend/services/claude.js` | — |
| NO TOUCH | `api/questions.js` | — |
| NO TOUCH | `api/complete.js` | — |

---

## generateDaily.js — 2-Line Change

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

## Cutover Sequence (do not swap generateDaily until all pass)

```sql
-- Required before wiring generateDaily:
SELECT category_id, COUNT(*) AS ready
FROM raw_articles
WHERE is_verified = true AND status = 'DONE'
  AND published_at > NOW() - INTERVAL '48 hours'
GROUP BY category_id;
-- Must have: world ≥ 2, tech ≥ 1, finance ≥ 1, culture ≥ 1
```

1. Deploy discovery + processing crns (shadow mode — generateDaily still uses newsdata.js)
2. Run for 24h
3. Manual verify: `UPDATE raw_articles SET is_verified=true WHERE source_domain IN ('reuters.com','apnews.com','bbc.com') AND status='DONE'`
4. Run verification query above — confirm all 4 categories covered
5. Apply 2-line change to generateDaily.js + deploy
6. Keep `NEWSDATA_API_KEY` in env for 1 week as rollback

---

## Rollback

Revert the 2 lines in `generateDaily.js` → NewsData.io re-activates instantly.
All new tables and files are purely additive.
