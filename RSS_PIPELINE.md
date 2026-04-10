# RSS Crawl Pipeline — Implementation Tracker

Replacing NewsData.io with a self-hosted RSS crawl pipeline.
Full design: [`docs/rss-pipeline-design.md`](docs/rss-pipeline-design.md)

**Branch:** `feature/rsscrawler1`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

---

## Architecture (MVP)

```
Discovery Cron (30 min)  →  scrape_queue (Supabase)  →  Processing Worker (5 min)
                                                                  ↓
                                                           raw_articles (Supabase)
                                                           [is_verified = false]
                                                                  ↓  manual review
                                                           articleStore.js
                                                                  ↓
                                                           generateDaily.js → claude.js
```

**Deferred to v2:** story clustering, Jaccard similarity, triangulation gate (≥3 sources)
**MVP dedup:** SHA256(canonical_url) + ON CONFLICT DO NOTHING only

---

## Phase 1 — Database

| # | Task | Status |
|---|------|--------|
| 1.1 | Create `backend/db/migration_scrape_queue.sql` | ✅ |
| 1.2 | Create `backend/db/migration_raw_articles.sql` | ✅ |
| 1.3 | Run both migrations in Supabase SQL editor | ✅ |
| 1.4 | Verify tables + indexes in Supabase dashboard | ✅ |

**Tables:**
- `scrape_queue` — job queue (url_hash, canonical_url, status, retry_count, last_error, authority_score, ...)
- `raw_articles` — cleaned articles (url_hash, canonical_url, content, content_hash, is_verified, authority_score, status, ...)

**Status values:**
- `scrape_queue`: PENDING → PROCESSING → DONE | PARTIAL | LOW_QUALITY | FAILED
- `raw_articles`: DONE | PARTIAL | LOW_QUALITY

---

## Phase 2 — Dependencies & RSS Registry

| # | Task | Status |
|---|------|--------|
| 2.1 | `npm install rss-parser @mozilla/readability jsdom` | ✅ |
| 2.2 | Create `config/rss-feeds.js` — 65+ feeds with `authority_score` | ✅ |

**Feed schema:** `{ url, domain, category, authority_score }`
**Authority scores:** Reuters/AP = 1.0, BBC/NYT/Guardian = 0.8, Ars/Wired/Nature = 0.6, Engadget/ZDNet = 0.4

---

## Phase 3 — URL Canonicalization Utility

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `backend/utils/canonicalise.js` | ✅ |

**Rules:**
- Force `https`
- Lowercase hostname
- Remove trailing slash from path
- Strip tracking params: `utm_*`, `ref`, `source`, `campaign`, `fbclid`, `gclid`, `mc_*`
- Sort remaining params alphabetically
- Remove fragment
- `url_hash = SHA256(canonical_url)`

---

## Phase 4 — Discovery Cron

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `backend/services/discoverer.js` — RSS fetch + queue insert | ✅ |
| 4.2 | Create `api/cron/discover.js` — Vercel Function handler | ✅ |
| 4.3 | Add to `vercel.json`: `*/30 * * * *` schedule | ✅ |
| 4.4 | Smoke-test locally: run discoverer, check `scrape_queue` fills | ✅ |
| 4.5 | Run twice — confirm `urls_skipped` = prior `urls_queued` (idempotency works) | ✅ |

**Output per run:** `{ feeds_attempted, feeds_ok, feeds_failed, urls_queued, urls_skipped }`
Logs structured JSON (see Observability section in design doc).

---

## Phase 5 — Processing Worker

| # | Task | Status |
|---|------|--------|
| 5.1 | Create `backend/services/scraper.js` — fetch + Readability extract | ✅ |
| 5.2 | Create `backend/services/processor.js` — batch worker with concurrency caps | ✅ |
| 5.3 | Create `api/cron/process.js` — Vercel Function handler | ✅ |
| 5.4 | Add to `vercel.json`: `*/5 * * * *` schedule, `maxDuration: 60` | ✅ |
| 5.5 | Smoke-test: run processor, check `raw_articles` fills | ⬜ |
| 5.6 | Verify `is_verified = false` on all inserted rows | ⬜ |
| 5.7 | Verify `status = 'LOW_QUALITY'` for short/paywalled content | ⬜ |
| 5.8 | Verify retry logic: force a 404 URL → confirm retry_count increments | ⬜ |

**Concurrency caps:** global = 8, per-domain = 2
**Retry budget:** MAX_RETRIES = 3
**Low-quality threshold:** MIN_CONTENT_LENGTH = 200 chars

---

## Phase 6 — Article Store

| # | Task | Status |
|---|------|--------|
| 6.1 | Create `backend/services/articleStore.js` — replaces newsdata.js | ✅ |
| 6.2 | Manually verify first batch in Supabase (`is_verified = true` for trusted sources) | ⬜ |
| 6.3 | Test `fetchStoriesForCategory("world")` returns `{title, description}` | ⬜ |
| 6.4 | Test all 4 categories in EDITORIAL_MIX return results | ⬜ |

**Query:** `WHERE is_verified = true AND status = 'DONE' AND published_at > NOW() - INTERVAL '48 hours'`
**Ordering:** `authority_score DESC, published_at DESC`

---

## Phase 7 — Cleanup Cron

| # | Task | Status |
|---|------|--------|
| 7.1 | Create `api/cron/cleanup.js` — 7-day TTL deletion | ✅ |
| 7.2 | Add to `vercel.json`: `0 3 * * *` schedule | ✅ |

**Deletes:** `raw_articles` + `scrape_queue` (DONE/FAILED/LOW_QUALITY only) older than 7 days

---

## Phase 8 — Wire Up generateDaily (2-line change)

| # | Task | Status |
|---|------|--------|
| 8.1 | Confirm verified article coverage for all 4 categories (run verification query) | ⬜ |
| 8.2 | Edit `backend/jobs/generateDaily.js` line 11: swap import | ✅ |
| 8.3 | Edit `backend/jobs/generateDaily.js` line 73: swap call | ✅ |
| 8.4 | Run `node backend/jobs/generateDaily.js` end-to-end — confirm 5 questions | ⬜ |

**Verification query before 8.2:**
```sql
SELECT category_id, COUNT(*) AS ready
FROM raw_articles
WHERE is_verified = true AND status = 'DONE'
  AND published_at > NOW() - INTERVAL '48 hours'
GROUP BY category_id;
-- Need: world ≥ 2, tech ≥ 1, finance ≥ 1, culture ≥ 1
```

---

## Phase 9 — Deploy & Cutover

| # | Task | Status |
|---|------|--------|
| 9.1 | Deploy to Vercel staging (discovery + processing crns only, generateDaily still uses newsdata.js) | ⬜ |
| 9.2 | Let shadow pipeline run for 24h | ⬜ |
| 9.3 | Manual verification batch: approve trusted sources in Supabase | ⬜ |
| 9.4 | Confirm `articleStore` returns results for all 4 categories | ⬜ |
| 9.5 | Deploy 2-line generateDaily change | ⬜ |
| 9.6 | Monitor 7AM generation run | ⬜ |
| 9.7 | Confirm quiz questions are sourced from RSS (check logs) | ⬜ |
| 9.8 | Keep `NEWSDATA_API_KEY` in env for 1 week (rollback safety) | ⬜ |

---

## Phase 10 — Cleanup

| # | Task | Status |
|---|------|--------|
| 10.1 | Remove `NEWSDATA_API_KEY` from Vercel env | ⬜ |
| 10.2 | Delete `backend/services/newsdata.js` | ⬜ |
| 10.3 | Remove `newsDataTag` field from `config/categories.js` | ⬜ |

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
| MODIFY | `backend/jobs/generateDaily.js` (2 lines) | 8 |
| MODIFY | `vercel.json` (3 new crons + maxDuration) | 4/5/7 |
| DELETE | `backend/services/newsdata.js` | 10 |
| MODIFY | `config/categories.js` (remove newsDataTag) | 10 |
| NO TOUCH | `backend/services/claude.js` | — |
| NO TOUCH | `api/questions.js` | — |
| NO TOUCH | `api/complete.js` | — |

---

## Rollback

Revert the 2 lines in `backend/jobs/generateDaily.js` → NewsData.io re-activates instantly.
All new tables and service files are purely additive.
