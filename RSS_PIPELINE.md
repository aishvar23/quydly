# RSS Crawl Pipeline — Plan & Tracker

Replacing NewsData.io with a self-hosted RSS crawl model. Free, no paid API. Stories are only flagged "quiz-ready" once 3+ unique publishers have covered them (triangulation gate).

**Branch:** `feature/rss-crawl-pipeline`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

---

## Architecture Overview

```
RSS Registry (65+ feeds)
        ↓  every 30 min (Vercel Cron)
  ingestor.js
    ├─ 1. Upsert by URL → skip if exists
    ├─ 2. Scrape inline → cheerio extracts <article> body
    ├─ 3. Anchor query → find same-category articles (last 48h)
    ├─ 4. Jaccard similarity → if ≥ 0.7 match, reuse cluster_id; else new UUID
    └─ 5. INSERT raw_articles (title, summary, full_content, published_at, cluster_id)
                         ↓
                   raw_articles (Supabase)
                         ↓  quiz-ready = cluster_id with ≥3 distinct domains
                   articleStore.js
                         ↓  returns {title, description}  ← same interface as newsdata.js
                   generateDaily.js  ──→  claude.js (untouched)
```

**Key contract preserved:** `articleStore.fetchStoriesForCategory(categoryId)` → `{title, description}`. `claude.js` and all quiz generation code are untouched.

---

## Schema

### New table: `raw_articles`

```sql
CREATE TABLE IF NOT EXISTS raw_articles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  url              text        UNIQUE NOT NULL,
  url_hash         text        UNIQUE NOT NULL,          -- SHA-256 of normalised URL
  title            text        NOT NULL,
  summary          text,                                 -- RSS snippet (≤1000 chars)
  full_content     text,                                 -- scraped <article> body
  source_domain    text        NOT NULL,                 -- e.g. "bbc.com"
  category_id      text        NOT NULL,                 -- world|tech|finance|culture|science
  cluster_id       uuid,                                 -- dynamically assigned at insert time
  published_at     timestamptz,                          -- from RSS <pubDate>
  ingested_at      timestamptz DEFAULT now()
);

-- Primary query path: quiz-ready clusters per category in last 48h
CREATE INDEX IF NOT EXISTS idx_raw_articles_category_cluster
  ON raw_articles (category_id, cluster_id, ingested_at DESC);

-- Anchor query: find potential matches for incoming article
CREATE INDEX IF NOT EXISTS idx_raw_articles_anchor
  ON raw_articles (category_id, published_at DESC);

-- Dedup check
CREATE INDEX IF NOT EXISTS idx_raw_articles_url_hash
  ON raw_articles (url_hash);
```

**Changed from original plan:** `story_group_hash` (pre-computed keyword hash) → `cluster_id` (UUID, dynamically assigned via Jaccard at insert time). Also added `published_at`.

---

## Ingestor Logic (per new article)

```
1. normalise URL → SHA-256 url_hash
2. SELECT id FROM raw_articles WHERE url_hash = ? → if exists, SKIP
3. scrape(url) → extract full_content via cheerio:
     - remove: script, style, nav, header, footer, aside, [class*="ad"]
     - try selectors in order: article, [class*="article-body"], [class*="story-body"],
       [class*="entry-content"], main
     - join <p> tags with >40 chars, truncate to 5000 chars
     - fall back to RSS summary if scrape fails / returns <200 chars
4. anchor query:
     SELECT id, title, cluster_id FROM raw_articles
     WHERE category_id = ? AND published_at > NOW() - INTERVAL '48 hours'
5. for each candidate: jaccardSimilarity(newTitle, candidate.title)
     tokenize = lowercase → strip punctuation → split → remove stopwords → Set
     jaccard = |A ∩ B| / |A ∪ B|
6. if any candidate.jaccard >= 0.7 → cluster_id = candidate.cluster_id
   else → cluster_id = gen_random_uuid()
7. INSERT raw_articles (url, url_hash, title, summary, full_content,
                        source_domain, category_id, cluster_id,
                        published_at, ingested_at)
```

**O(n²) avoided:** The anchor query returns only same-category articles from the last 48h. In practice this is ~50–200 rows per category — O(k) per insert, not O(n²) over the full table.

---

## articleStore Query (quiz-ready gate)

A cluster is "quiz-ready" when `cluster_id` has ≥3 rows with distinct `source_domain` in the last 48h.

```sql
-- Find quiz-ready cluster_ids for a category
SELECT cluster_id, COUNT(DISTINCT source_domain) AS domain_count
FROM raw_articles
WHERE category_id = $1
  AND published_at > NOW() - INTERVAL '48 hours'
GROUP BY cluster_id
HAVING COUNT(DISTINCT source_domain) >= 3
ORDER BY domain_count DESC;
```

Pick a random quiz-ready cluster → select one article from it (prefer rows with `full_content`) → return `{title, description: full_content.slice(0, 500)}`.

---

## Implementation Phases

### Phase 1 — Database

| # | Task | Status |
|---|------|--------|
| 1.1 | Create `backend/db/migration_raw_articles.sql` with schema above | ⬜ |
| 1.2 | Run migration in Supabase SQL editor | ⬜ |
| 1.3 | Verify table + 3 indexes exist in Supabase dashboard | ⬜ |

---

### Phase 2 — Dependencies & RSS Registry

| # | Task | Status |
|---|------|--------|
| 2.1 | `npm install rss-parser cheerio` | ⬜ |
| 2.2 | Create `config/rss-feeds.js` — 65+ feeds across 5 categories | ⬜ |

Feed structure: `{ url, domain, category }` where `category` ∈ `{world, tech, finance, culture, science}`.

---

### Phase 3 — Ingestor + Inline Scraper

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `backend/services/scraper.js` — cheerio extractor | ⬜ |
| 3.2 | Create `backend/services/ingestor.js` — full flow (fetch → upsert → scrape → anchor → jaccard → insert) | ⬜ |
| 3.3 | Smoke-test locally against a single feed | ⬜ |
| 3.4 | Run twice — confirm second run shows 0 inserted (dedup works) | ⬜ |
| 3.5 | Inspect `raw_articles` in Supabase — verify `full_content` is populated, `cluster_id` groups related articles | ⬜ |

---

### Phase 4 — Article Store

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `backend/services/articleStore.js` | ⬜ |
| 4.2 | Wait for ≥4h of ingest cycles before testing (need cluster coverage) | ⬜ |
| 4.3 | Run quiz-ready verification SQL (see below) | ⬜ |
| 4.4 | Test `fetchStoriesForCategory("world")` returns `{title, description}` | ⬜ |

**Verification SQL** — run before wiring up generateDaily:
```sql
SELECT category_id, COUNT(DISTINCT cluster_id) AS ready_clusters
FROM (
  SELECT category_id, cluster_id
  FROM raw_articles
  WHERE published_at > NOW() - INTERVAL '48 hours'
  GROUP BY category_id, cluster_id
  HAVING COUNT(DISTINCT source_domain) >= 3
) t
GROUP BY category_id;
```
Need: `world` ≥ 2, others ≥ 1 (matches `EDITORIAL_MIX`).

---

### Phase 5 — Wire Up generateDaily (2-line change)

| # | Task | Status |
|---|------|--------|
| 5.1 | `backend/jobs/generateDaily.js` line 11: change import from `fetchHeadline` → `fetchStoriesForCategory` | ⬜ |
| 5.2 | `backend/jobs/generateDaily.js` line 73: change call from `fetchHeadline(category.newsDataTag)` → `fetchStoriesForCategory(category.id)` | ⬜ |
| 5.3 | Run `node backend/jobs/generateDaily.js` end-to-end — confirm 5 questions generated | ⬜ |

---

### Phase 6 — Vercel Cron

| # | Task | Status |
|---|------|--------|
| 6.1 | Create `api/cron/ingest.js` — Vercel Function handler (CRON_SECRET guard) | ⬜ |
| 6.2 | Update `vercel.json` — add `*/30 * * * *` schedule + `maxDuration: 60` for ingest function | ⬜ |
| 6.3 | Deploy to Vercel staging | ⬜ |
| 6.4 | Manually `POST /api/cron/ingest` with `Authorization: Bearer <CRON_SECRET>` | ⬜ |
| 6.5 | Confirm Vercel logs show inserted/skipped counts and no timeout | ⬜ |

---

### Phase 7 — Cutover & Cleanup

| # | Task | Status |
|---|------|--------|
| 7.1 | Monitor `raw_articles` growth over 24h | ⬜ |
| 7.2 | Confirm `generateDaily` 7AM run sources from `articleStore` | ⬜ |
| 7.3 | Remove `NEWSDATA_API_KEY` from Vercel env | ⬜ |
| 7.4 | Delete `backend/services/newsdata.js` (now orphaned) | ⬜ |

---

## File Inventory

| Action | File | Phase |
|--------|------|-------|
| CREATE | `backend/db/migration_raw_articles.sql` | 1 |
| CREATE | `config/rss-feeds.js` | 2 |
| CREATE | `backend/services/scraper.js` | 3 |
| CREATE | `backend/services/ingestor.js` | 3 |
| CREATE | `backend/services/articleStore.js` | 4 |
| MODIFY | `backend/jobs/generateDaily.js` (2 lines) | 5 |
| CREATE | `api/cron/ingest.js` | 6 |
| MODIFY | `vercel.json` | 6 |
| DELETE | `backend/services/newsdata.js` | 7 |
| NO TOUCH | `config/categories.js` | `newsDataTag` unused but harmless |
| NO TOUCH | `backend/services/claude.js` | contract unchanged |
| NO TOUCH | `api/questions.js` | no changes |
| NO TOUCH | `api/complete.js` | no changes |

---

## Rollback

Revert the 2 lines in `backend/jobs/generateDaily.js` → NewsData.io re-activates instantly. `raw_articles` table and new services are purely additive.
