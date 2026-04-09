# Design Document: RSS Crawl Pipeline

**Feature:** Replace NewsData.io API with a self-hosted RSS crawl + article scrape pipeline
**Branch:** `feature/rss-crawl-pipeline`
**Status:** Design approved, implementation not started
**Authors:** Aishvarya Suhane

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Problem Statement](#2-problem-statement)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Data Model](#5-data-model)
6. [Component Design](#6-component-design)
7. [Drawbacks & Concerns](#7-drawbacks--concerns)
8. [Open Questions](#8-open-questions)

---

## 1. Current State

### What Quydly Is

A daily news quiz. 5 questions per session, resets at 7AM UTC. Wordle-style ritual — users feel informed, not tested. Points, streaks, global rank.

### Current Content Pipeline

```
7:00 AM UTC
     │
     ▼
generateDaily.js (Vercel Cron)
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
     │               Prompt: title + description → quiz question
     │               Returns: { question, options[4], correctIndex, tldr, categoryId }
     │
     ▼
Redis (primary cache, key: "questions:YYYY-MM-DD", TTL: 24h)
     │
     ▼  (fallback if Redis unavailable)
Supabase → daily_questions table (date, questions jsonb)
     │
     ▼
GET /api/questions → serves today's 5 questions to app
```

### Current Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React Native (Expo) |
| Backend API | Node.js + Express (Vercel Functions via `api/`) |
| News source | **NewsData.io REST API** (paid, categorised) |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Database | Supabase (PostgreSQL) |
| Cache | Redis (ioredis) |
| Auth | Supabase Auth |
| Email | Resend |
| Payments | Stripe (stub only) |
| Deploy | Vercel |

### What NewsData.io Gives Us Today

- Single API call per category → returns top article with `title` + `description`
- Pre-categorised (world, technology, business, entertainment, science)
- Rate-limited, no full article body
- Paid tier required for production volume

### Current Limitations

| Limitation | Impact |
|-----------|--------|
| Paid API — cost scales with usage | Adds ongoing cost, rate limit risk |
| Only returns headline + 1-sentence snippet | Claude gets thin context → quiz questions are generic |
| No source verification | One API decides what's "top news" — no triangulation |
| Single point of failure | If NewsData.io is down at 7AM, quiz generation fails |
| No story deduplication | Same event could appear across different category tags |
| No control over source quality | Can't curate which publishers we trust |

---

## 2. Problem Statement

NewsData.io gives us a headline and a snippet. That's it. The quiz quality ceiling is set by how much context Claude gets — and a 1-sentence RSS description isn't much.

More importantly, we have no way to know if a story is actually significant. A story that BBC, Reuters, AP, and the Guardian are all covering independently is objectively more newsworthy than one only a single outlet filed. We want that signal.

We also want to stop paying for data that is freely available via public RSS feeds.

**Goals:**

1. **Zero cost** — replace paid API with free public RSS feeds
2. **Richer context** — give Claude the full article body, not just a headline
3. **Triangulation** — only quiz on stories covered by ≥3 independent sources
4. **Source control** — we curate the publisher registry; bad/fringe sources never enter
5. **Resilience** — no single API dependency for 7AM generation

---

## 3. Proposed Architecture

### High-Level Flow

```
RSS Registry (65+ feeds, curated per category)
          │
          │  every 30 minutes (Vercel Cron)
          ▼
    ┌─────────────────────────────────────────────┐
    │              ingestor.js                    │
    │                                             │
    │  1. Fetch all feeds (parallel, batches=10)  │
    │  2. For each new article URL:               │
    │     a. Dedup check (url_hash → skip if seen)│
    │     b. Scrape full article body (cheerio)   │
    │     c. Anchor query (same cat, last 48h)    │
    │     d. Jaccard similarity ≥0.7 → cluster_id │
    │     e. INSERT raw_articles                  │
    └─────────────────────────────────────────────┘
          │
          ▼
    raw_articles (Supabase)
    ┌──────────────────────────────────┐
    │ url_hash | title | full_content  │
    │ source_domain | category_id      │
    │ cluster_id | published_at        │
    └──────────────────────────────────┘
          │
          │  7:00 AM UTC (existing Vercel Cron, unchanged)
          ▼
    generateDaily.js
          │
          ├─ for each category in EDITORIAL_MIX
          │         │
          │         ▼
          │   articleStore.js
          │   Query: cluster_id with ≥3 distinct source_domains (last 48h)
          │   Returns: { title, description: full_content.slice(0,500) }
          │         │
          │         ▼
          │   claude.js  ← UNCHANGED
          │   Richer context → better quiz question
          │
          ▼
    Redis + Supabase cache (unchanged)
          │
          ▼
    GET /api/questions → app (unchanged)
```

### What Changes vs. What Stays the Same

| Component | Change |
|-----------|--------|
| `newsdata.js` | Replaced by `articleStore.js` |
| `generateDaily.js` | 2-line change: swap import + call |
| `claude.js` | **Untouched** |
| `api/questions.js` | **Untouched** |
| `api/complete.js` | **Untouched** |
| Redis/Supabase caching | **Untouched** |
| `config/categories.js` | `newsDataTag` field becomes unused (left in place) |

The contract `{title, description}` is preserved end-to-end. Claude never knows where its input came from.

---

## 4. Tech Stack

### New Components

| Component | Technology | Why |
|-----------|-----------|-----|
| RSS parsing | `rss-parser` (npm) | Battle-tested, handles RSS 2.0 + Atom, returns structured JS objects |
| Article scraping | `cheerio` (npm) | jQuery-like HTML parsing, no headless browser, Vercel-compatible |
| Story clustering | Jaccard similarity (custom, no library) | No NLP dependency, O(k) per insert, deterministic |
| Article store | Supabase (existing) | New `raw_articles` table in same DB, no new infrastructure |
| Ingest cron | Vercel Cron (existing mechanism) | Same pattern as `generate.js`, 30-min schedule |

### Why Not Puppeteer / Playwright?

Headless browsers require ~150MB of Chromium binaries. Vercel Functions have a 50MB unzipped limit by default. The `@sparticuz/chromium` shim exists but adds complexity and cold-start latency. For major news publishers (BBC, Reuters, AP, NYT, Guardian), the full article text is available in plain HTML — no JavaScript rendering required. Cheerio covers ~80% of our target sources. The remaining ~20% (heavy JS, hard paywalls) are inaccessible to any scraper without authentication.

### Why Not Newspaper3k?

Python-only. Our backend is Node.js (ESM). Adding a Python Vercel Function creates a separate runtime, a separate deployment surface, and inter-service HTTP calls. The benefit doesn't justify the complexity for our use case.

### Why Not a Managed News API (e.g. GDELT, MediaStack, GNews)?

They all have the same problem as NewsData.io: paid at scale, no full article body, no triangulation control. We'd still be paying for something we can do ourselves for free.

### Full Stack After Migration

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React Native (Expo) | No change |
| Backend API | Node.js + Express (Vercel Functions) | No change |
| **News ingest** | **rss-parser + cheerio (Vercel Cron)** | **New** |
| **Article DB** | **Supabase `raw_articles` table** | **New table** |
| AI | Claude API (`claude-sonnet-4-20250514`) | No change |
| Question cache | Redis + Supabase `daily_questions` | No change |
| Auth | Supabase Auth | No change |
| Email | Resend | No change |
| Payments | Stripe (stub) | No change |
| Deploy | Vercel | No change |

---

## 5. Data Model

### New Table: `raw_articles`

```sql
CREATE TABLE IF NOT EXISTS raw_articles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  url              text        UNIQUE NOT NULL,
  url_hash         text        UNIQUE NOT NULL,
  -- url_hash = SHA-256 of normalised URL (utm_* stripped, fragment removed)

  title            text        NOT NULL,
  summary          text,
  -- RSS <description> or <contentSnippet>, ≤1000 chars

  full_content     text,
  -- Scraped article body (cheerio), ≤5000 chars. NULL if scrape fails.

  source_domain    text        NOT NULL,
  -- e.g. "bbc.com" — used for triangulation (distinct domain count)

  category_id      text        NOT NULL,
  -- world | tech | finance | culture | science (matches config/categories.js)

  cluster_id       uuid,
  -- Dynamically assigned at insert time via Jaccard similarity.
  -- Articles about the same story share a cluster_id.

  published_at     timestamptz,
  -- From RSS <pubDate>. Used to bound anchor queries (last 48h window).

  ingested_at      timestamptz DEFAULT now()
  -- When we processed it.
);

CREATE INDEX idx_raw_articles_category_cluster
  ON raw_articles (category_id, cluster_id, ingested_at DESC);

CREATE INDEX idx_raw_articles_anchor
  ON raw_articles (category_id, published_at DESC);

CREATE INDEX idx_raw_articles_url_hash
  ON raw_articles (url_hash);
```

### Cluster Assignment Algorithm

Run once per new article at insert time:

```
1. Tokenise title:
   - lowercase
   - strip punctuation  /[^a-z0-9\s]/g → ""
   - split on whitespace
   - remove stopwords (the, a, an, is, are, was, of, to, in, ...)

2. Anchor query:
   SELECT id, title, cluster_id FROM raw_articles
   WHERE category_id = ? AND published_at > NOW() - INTERVAL '48 hours'
   -- Bounded to same category + 48h → typically 50-200 rows

3. For each candidate:
   jaccard = |tokens(newTitle) ∩ tokens(candidate.title)| /
             |tokens(newTitle) ∪ tokens(candidate.title)|

4. if any jaccard >= 0.70:
     cluster_id = candidate.cluster_id   (join existing cluster)
   else:
     cluster_id = gen_random_uuid()      (start new cluster)
```

**Why 0.70?**
- 0.70 catches paraphrasings: "Trump signs Greenland deal" ↔ "US acquires Greenland, Trump confirms"
- Below 0.60 false positives appear (unrelated stories sharing common political vocabulary)
- Above 0.80 misses legitimate variations in headline phrasing

### Quiz-Ready Gate

A story is promoted to "quiz-ready" when its `cluster_id` has ≥3 rows with distinct `source_domain` values published within the last 48 hours.

```sql
SELECT cluster_id, COUNT(DISTINCT source_domain) AS coverage
FROM raw_articles
WHERE category_id = $1
  AND published_at > NOW() - INTERVAL '48 hours'
GROUP BY cluster_id
HAVING COUNT(DISTINCT source_domain) >= 3
ORDER BY coverage DESC;
```

---

## 6. Component Design

### `config/rss-feeds.js`

Array of 65 feed entries: `{ url, domain, category }`. Distribution: world×14, tech×13, finance×13, culture×13, science×12.

Sources: BBC, Reuters, AP, NYT, Guardian, FT, Economist, Al Jazeera, Washington Post, NPR, DW, France24, Sky News, Ars Technica, Wired, TechCrunch, The Verge, MIT Technology Review, Engadget, ZDNet, Bloomberg, CNBC, Fortune, MarketWatch, Rolling Stone, Variety, Deadline, Pitchfork, Hollywood Reporter, NME, New Scientist, Nature, Scientific American, ScienceDaily, Phys.org, Popular Science.

### `backend/services/scraper.js`

```
Input:  url (string)
Output: string (article body, ≤5000 chars) | null (if fails)

Steps:
  1. fetch(url, { timeout: 9s, User-Agent: "QuydlyBot/1.0" })
  2. If non-200 → return null
  3. load HTML into cheerio
  4. Remove: script, style, nav, header, footer, aside, [class*="ad"], [id*="ad"]
  5. Try selectors in order:
       article
       [class*="article-body"]
       [class*="article__body"]
       [class*="story-body"]
       [class*="entry-content"]
       main
  6. For first matching selector:
       collect all <p> with >40 chars
       join with " "
       if result.length > 200 → return result.slice(0, 5000)
  7. Fall through all selectors → return null
```

A null result is not an error — the ingestor falls back to the RSS summary, and `articleStore` will still use that article (just with less context for Claude).

### `backend/services/ingestor.js`

```
Input:  none (reads RSS_FEEDS from config)
Output: { inserted: number, skipped: number }

Steps:
  1. Parse all 65 feeds in parallel batches of 10
     (batch size prevents hammering publishers simultaneously)
  2. For each feed item:
     a. Skip if title or URL is missing
     b. Normalise URL (strip utm_*, fbclid, fragment)
     c. SHA-256 url_hash → check raw_articles for existing
     d. If exists → skipped++, continue
     e. scrapeArticle(url) → full_content (or null)
     f. Jaccard anchor query (same category, last 48h)
     g. Assign cluster_id
     h. INSERT raw_articles
     i. inserted++
  3. Return { inserted, skipped }
```

**Concurrency design:** RSS fetches are parallel (10 at a time). Scraping + DB writes per article are serial within each feed's item loop. This avoids saturating Vercel's outbound connection pool and keeps memory usage flat.

### `backend/services/articleStore.js`

```
Input:  categoryId (string)
Output: { title: string, description: string }

Steps:
  1. Query quiz-ready cluster_ids (≥3 distinct domains, last 48h, same category)
  2. If none found → fallback: most recent article in category (last 48h)
  3. If nothing in 48h → throw (generateDaily catches and logs)
  4. Pick random quiz-ready cluster
  5. Fetch up to 5 articles from that cluster → prefer one with full_content
  6. Return { title, description: (full_content ?? summary).slice(0,500) }
```

### `api/cron/ingest.js`

Vercel Function handler. Identical guard pattern to `api/cron/generate.js` (CRON_SECRET via `Authorization: Bearer`). Calls `ingestFeeds()`, returns `{ ok, inserted, skipped, timestamp }`.

### Modified `backend/jobs/generateDaily.js`

Two lines change. No other modifications.

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

## 7. Drawbacks & Concerns

### 7.1 Vercel Function Timeout (High Priority)

**Problem:** The ingest cron scrapes articles inline. On first run with 65 feeds × ~10 items each = ~650 potential scrape calls. At 1–3s per scrape, that's 650–1950 seconds — far beyond Vercel's 60s Pro limit.

**Mitigation:**
- After the first run, the vast majority of articles will be skipped (already in DB). Subsequent runs are fast — typically 5–20 new articles per 30-min cycle.
- First-run seeding should be done locally (`node backend/services/ingestor.js`) before deploying the cron, not through Vercel.
- Add `SCRAPE_ENABLED=true` env flag — if disabled, ingestor stores RSS summary only (no HTTP scrape). First deploy with scraping off, seed locally, then enable.

**Residual risk:** A new publisher with a large backlog could cause a slow run if many new URLs appear simultaneously (e.g., after adding new feeds to the registry).

### 7.2 Scrape Failures & Paywalls (~20% of sources)

**Problem:** Bloomberg, FT, NYT, and The Economist have hard paywalls. Cheerio will fetch the page but get a login wall, not article text. `full_content` will be null for these.

**Mitigation:**
- These sources are still valuable for `title` and `summary` (RSS always gives this, paywall or not).
- The Jaccard clustering still works on their titles — they contribute to triangulation.
- Claude will use the RSS summary for these sources, which is acceptable (it's what we use today with NewsData.io).
- Practically, for heavily covered stories BBC/Reuters/AP/Guardian will have full text — the paywalled sources add triangulation signal without needing their full body.

**Residual risk:** If the only sources covering a story are paywalled, Claude gets thin context. Rare in practice — major stories are always covered by open-access wire services.

### 7.3 Jaccard False Positives / False Negatives

**Problem:** A 0.70 threshold is a heuristic. It can fail in two directions:

- **False positive (over-clustering):** "Apple launches new phone" and "Apple CEO phone call with investor" both contain `apple` and `phone` — could cluster incorrectly.
- **False negative (under-clustering):** "Gaza ceasefire agreement reached" and "Hamas and Israel agree to pause fighting" share little vocabulary despite being the same story.

**Mitigation:**
- Over-clustering is less harmful than under-clustering — a merged cluster just means more domain coverage, still produces a valid quiz question.
- The 48-hour + same-category bounds significantly reduce false positives (the two Apple examples would need to arrive within 48h in the same category).
- False negatives mean a real story gets two separate clusters, each with fewer source domains — it might not hit the ≥3 threshold and gets skipped. The fallback (`most recent article`) catches this.

**Residual risk:** A genuinely major story might be missed if it's phrased very differently across publishers. Acceptable for a quiz — we have many stories per category to choose from.

### 7.4 RSS Feed Reliability

**Problem:** RSS feeds go down, change URLs, go behind auth, or return malformed XML. We're depending on 65 external URLs.

**Mitigation:**
- `rss-parser` errors per feed are caught and logged individually — one broken feed doesn't stop the run.
- Feed failures are silent to end users; the ingestor just skips that source for that cycle.
- If a major source (e.g. Reuters) breaks its RSS, we lose their triangulation contribution — but the ≥3 threshold is still achievable from the other 13 world feeds.

**Monitoring needed:** Alert when a given feed fails for >3 consecutive cycles (not implemented in v1 — log-based monitoring only).

### 7.5 `cluster_id` Persistence Risk

**Problem:** `cluster_id` is assigned at insert time by comparing against articles from the last 48 hours. If the ingestor runs on two overlapping batches in quick succession (race condition), two threads could assign different `cluster_id` values to articles that should be in the same cluster.

**Mitigation:**
- Vercel cron fires once per 30 minutes per function instance — not concurrent by default.
- The `url_hash` unique constraint prevents the same article being inserted twice.
- Race condition is only possible if two separate cron triggers overlap (extremely rare, and only affects articles at the boundary of the 48h window).

**Residual risk:** Low. Worst case: some articles that should cluster together get separate `cluster_id` values → they each need 3 independent domain sources rather than sharing. This reduces quiz-ready coverage slightly but doesn't cause incorrect quiz questions.

### 7.6 Database Growth

**Problem:** `raw_articles` accumulates indefinitely. At 20 new articles per 30-min cycle × 48 cycles/day = ~960 rows/day. After a year: ~350k rows.

**Mitigation:**
- Add a cleanup cron (daily or weekly) to `DELETE FROM raw_articles WHERE ingested_at < NOW() - INTERVAL '30 days'`. This is a 10-line addition, not implemented in v1.
- At 350k rows with the current indexes, query performance is still fast (the index on `category_id, cluster_id, ingested_at` is selective).

**Not urgent:** Supabase free tier supports 500MB of database storage. At ~500 bytes per row average, 350k rows = ~175MB/year.

### 7.7 Bootstrap Problem (Day 1)

**Problem:** When the pipeline first deploys, `raw_articles` is empty. The 7AM `generateDaily` run will call `articleStore` → find nothing → throw → quiz generation fails.

**Mitigation (required before cutover):**
1. Run ingestor locally first (`node backend/services/ingestor.js`)
2. Wait for ≥4 cron cycles (2 hours) to accumulate triangulated clusters
3. Run the verification SQL query to confirm quiz-ready coverage in all categories
4. Only then swap the 2 lines in `generateDaily.js`

The old `newsdata.js` remains available as an instant rollback.

### 7.8 robots.txt / Legal

**Problem:** Some publishers may have `robots.txt` entries disallowing crawlers, or ToS clauses against scraping.

**Mitigation:**
- We send a `User-Agent: QuydlyBot/1.0` identifying header — we are not hiding.
- We respect the HTTP response: if a page returns 403/429/401, we store `null` for `full_content` and move on.
- We are not storing full articles for redistribution — we extract ≤500 chars of context to generate quiz questions, which is consistent with fair use for educational/transformative purposes.
- RSS feeds are explicitly published for syndication; fetching them is the intended use.

**Residual risk:** Low for RSS fetching. Moderate for article scraping. If a publisher objects, removing their domain from `rss-feeds.js` immediately stops all ingestion from them.

---

## 8. Open Questions

| # | Question | Impact | Status |
|---|----------|--------|--------|
| Q1 | Should we add a `used_on` date field to prevent the same story being quizzed twice in the same week? | Low — low probability of collision given daily reset | Defer to v2 |
| Q2 | Should the `science` category be added to `EDITORIAL_MIX`? It's in `CATEGORIES` but excluded from the daily mix. | Medium — more variety | Separate decision, not blocked |
| Q3 | What's the retention policy for `raw_articles`? 7 days? 30 days? | Storage cost | Implement cleanup cron in v1 or v2 |
| Q4 | Do we alert/page when quiz-ready coverage drops below threshold at 6AM? | High — silent failure risk | Add monitoring before cutover |
| Q5 | Jaccard threshold: 0.70 is a heuristic — do we want A/B data before locking it in? | Low initially | Review after 1 week of data |

---

## Summary

| Dimension | Current | Proposed |
|-----------|---------|----------|
| News source | Paid API (NewsData.io) | Free public RSS (65 feeds) |
| Article context | Headline + 1-sentence snippet | Full article body (≤5000 chars) |
| Story verification | None (single API decides) | Triangulation: ≥3 independent sources |
| Source curation | API provider controls | We control the publisher registry |
| Single point of failure | Yes (NewsData.io at 7AM) | No — 65 sources, graceful per-feed fallback |
| Clustering | None | Jaccard similarity ≥0.70 within 48h window |
| Cost | Paid tier | $0 (Vercel Cron + existing Supabase) |
| Code changes | — | 6 new files, 2 modified, 1 deleted |
