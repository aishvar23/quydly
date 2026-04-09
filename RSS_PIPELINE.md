# RSS Crawl Pipeline — Plan & Tracker

Replacing NewsData.io with a self-hosted RSS crawl model. Free, no paid API. Stories are only flagged "quiz-ready" once 3+ unique publishers have covered them (triangulation gate).

**Branch:** `feature/rss-crawl-pipeline`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

---

## Architecture Overview

```
RSS Registry (65 feeds)
        ↓  every 15 min
  ingestor.js  ──→  raw_articles (Supabase)
                         ↓  story_group_hash clusters
                   articleStore.js  ──→  generateDaily.js  ──→  claude.js
```

**Contract preserved:** `articleStore.fetchStoriesForCategory(categoryId)` returns `{title, description}` — identical to what `newsdata.fetchHeadline()` returned. `claude.js` is untouched.

---

## Phase 1 — Database

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Run `migration_raw_articles.sql` in Supabase SQL editor | ⬜ | Additive only — no existing tables touched |
| 1.2 | Verify table + 3 indexes exist in Supabase dashboard | ⬜ | |

**Migration file to create:** `backend/db/migration_raw_articles.sql`

```sql
CREATE TABLE IF NOT EXISTS raw_articles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  url              text        UNIQUE NOT NULL,
  url_hash         text        UNIQUE NOT NULL,
  title            text        NOT NULL,
  summary          text,
  full_content     text,
  source_domain    text        NOT NULL,
  category_id      text        NOT NULL,
  story_group_hash text,
  ingested_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_articles_category_story_time
  ON raw_articles (category_id, story_group_hash, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_articles_url_hash
  ON raw_articles (url_hash);
CREATE INDEX IF NOT EXISTS idx_raw_articles_story_domain
  ON raw_articles (story_group_hash, source_domain);
```

---

## Phase 2 — Dependencies & Config

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | `npm install rss-parser cheerio node-fetch` | ⬜ | All Vercel-compatible, no native binaries |
| 2.2 | Create `config/rss-feeds.js` | ⬜ | 65 feeds: world×14, tech×13, finance×13, culture×13, science×12 |

**Story group hash algorithm** (implemented in `ingestor.js`):
1. Lowercase title → strip punctuation → split words
2. Remove stopwords (the, a, is, was, and, or, …)
3. Sort alphabetically → take first 5 tokens
4. SHA-256 of `word1|word2|word3|word4|word5`

Sorting is deterministic: "Trump signs China trade deal" and "China trade deal signed by Trump" → same hash.

---

## Phase 3 — Ingestor Service

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Create `backend/services/ingestor.js` | ⬜ | RSS-only, no scraping (keeps cron under 10s) |
| 3.2 | Smoke-test locally: `node -e "import('./backend/services/ingestor.js').then(m=>m.ingestFeeds())"` | ⬜ | Check `raw_articles` fills in Supabase |
| 3.3 | Run twice — confirm `skipped` count = prior `inserted` count (dedup works) | ⬜ | |

**Ingestor behaviour:**
- Fetches all 65 feeds in batches of 10 (parallel within batch, sequential across batches)
- Deduplicates by SHA-256 of normalised URL (strips `utm_*`, `fbclid`, fragments)
- Computes `story_group_hash` from title
- Stores: `url`, `url_hash`, `title`, `summary` (RSS snippet ≤1000 chars), `source_domain`, `category_id`, `story_group_hash`
- `full_content` left `null` (optional scraper, Phase 6)

---

## Phase 4 — Article Store (replaces newsdata.js)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Create `backend/services/articleStore.js` | ⬜ | Same return type as `fetchHeadline()` |
| 4.2 | Run verification SQL (see below) — confirm quiz-ready stories exist before wiring up | ⬜ | Need ≥4h of ingest runs first |
| 4.3 | Test locally: `fetchStoriesForCategory("world")` returns `{title, description}` | ⬜ | |

**Verification SQL (run in Supabase):**
```sql
SELECT category_id, COUNT(DISTINCT story_group_hash) AS ready_stories
FROM (
  SELECT category_id, story_group_hash
  FROM raw_articles
  WHERE ingested_at > NOW() - INTERVAL '24 hours'
  GROUP BY category_id, story_group_hash
  HAVING COUNT(DISTINCT source_domain) >= 3
) t
GROUP BY category_id;
```
Need: `world` ≥ 2, all others ≥ 1 (matches `EDITORIAL_MIX`).

---

## Phase 5 — Wire Up generateDaily

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Edit `backend/jobs/generateDaily.js` line 11: swap import | ⬜ | `fetchHeadline` → `fetchStoriesForCategory` |
| 5.2 | Edit `backend/jobs/generateDaily.js` line 73: swap call | ⬜ | `fetchHeadline(category.newsDataTag)` → `fetchStoriesForCategory(category.id)` |
| 5.3 | Run `node backend/jobs/generateDaily.js` end-to-end | ⬜ | Should generate 5 questions from RSS-sourced headlines |

**Only 2 lines change in this file. `claude.js` is not touched.**

---

## Phase 6 — Vercel Cron

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Create `api/cron/ingest.js` | ⬜ | Same CRON_SECRET guard as `generate.js` |
| 6.2 | Update `vercel.json` — add ingest cron + `maxDuration: 60` | ⬜ | Schedule: `*/15 * * * *` |
| 6.3 | Deploy to Vercel staging | ⬜ | |
| 6.4 | Manually `POST /api/cron/ingest` with `Authorization: Bearer <CRON_SECRET>` | ⬜ | Confirm logs show inserted/skipped counts |

---

## Phase 7 — Cutover & Cleanup

| # | Task | Status | Notes |
|---|------|--------|-------|
| 7.1 | Monitor `raw_articles` row count over 24h (should grow each 15-min cycle) | ⬜ | |
| 7.2 | Monitor `generateDaily` next 7AM run — confirm it sources from `articleStore` | ⬜ | |
| 7.3 | Remove `NEWSDATA_API_KEY` from Vercel env (`vercel env rm NEWSDATA_API_KEY`) | ⬜ | Only after 7.2 confirmed |
| 7.4 | (Optional) Delete `backend/services/newsdata.js` | ⬜ | Currently orphaned, safe to remove anytime |

---

## Phase 8 — Optional: Full-Text Scraper

| # | Task | Status | Notes |
|---|------|--------|-------|
| 8.1 | Create `backend/services/scraper.js` (node-fetch + cheerio) | ⬜ | Only if RSS summaries prove too thin for Claude |
| 8.2 | Gate behind `SCRAPE_ENABLED=true` env var in ingestor | ⬜ | |
| 8.3 | Add `SCRAPE_ENABLED` to Vercel env | ⬜ | |

---

## File Inventory

| Action | File | Phase |
|--------|------|-------|
| CREATE | `backend/db/migration_raw_articles.sql` | 1 |
| CREATE | `config/rss-feeds.js` | 2 |
| CREATE | `backend/services/ingestor.js` | 3 |
| CREATE | `backend/services/articleStore.js` | 4 |
| MODIFY | `backend/jobs/generateDaily.js` (2 lines) | 5 |
| CREATE | `api/cron/ingest.js` | 6 |
| MODIFY | `vercel.json` | 6 |
| CREATE | `backend/services/scraper.js` | 8 (optional) |
| NO TOUCH | `backend/services/newsdata.js` | orphaned |
| NO TOUCH | `config/categories.js` | `newsDataTag` unused but harmless |
| NO TOUCH | `backend/services/claude.js` | contract unchanged |

---

## Rollback

Revert the 2 lines in `generateDaily.js` → NewsData.io re-activates instantly. All new files and the `raw_articles` table are purely additive.
