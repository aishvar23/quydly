# Design Document: Gold Set Pipeline

**Feature:** Transform `raw_articles` into a continuously updating "Gold Set" of 20–50 high-quality, deduplicated, multi-source validated Stories per day
**Branch:** `feature/gold-set-pipeline`
**Status:** Design v1 — initial
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

### Current Content Pipeline (post-RSS migration)

```
5:00AM UTC
     │
     ▼
discover.js  (Vercel Cron, every 30 min)
     │  RSS feeds → scrape_queue
     ▼
process.js   (Vercel Cron, every 5 min)
     │  scrape_queue → raw_articles (is_verified = false)
     ▼
[Manual review → is_verified = true]
     │
     ▼
generateDaily.js  (Vercel Cron, 7AM)
     │  articleStore.fetchStoriesForCategory(categoryId)
     │    → single raw_article per category
     ▼
claude.js → question generation
```

### Current Limitations

| Limitation | Impact |
|-----------|--------|
| Single article per question | Thin context — one source's framing |
| No cross-source validation | A single incorrect or biased article can generate a wrong question |
| No deduplication by story topic | Same event from 10 sources floods a category, crowds out diverse stories |
| No signal about story importance | All DONE articles treated equally regardless of corroboration count |
| No persistent story representation | Each 7AM run is stateless — no accumulated understanding of evolving stories |

---

## 2. Problem Statement

`raw_articles` is a stream of individual articles. Some stories are covered by 15 sources; others by one. Claude currently picks from a ranked list and gets one article's take. There is no notion of a "story" — a coherent, multi-source narrative about a real-world event.

**Goals:**

1. **Story-level abstraction** — cluster related articles into a single Story entity
2. **Multi-source validation** — a Story requires ≥2 unique domains to exist (or one with authority ≥ 0.8)
3. **Richer Claude context** — pass synthesized narrative + key_points instead of a raw article slice
4. **Confidence scoring** — gate quiz generation on `confidence_score ≥ 6`
5. **River model** — Stories update as new articles arrive, not rebuilt from scratch each day
6. **Volume target** — 20–50 stories/day across all categories

---

## 3. Proposed Architecture

### Overview: Two-Phase Gold Set Model

Two new cron jobs run between the existing processing worker and quiz generation.

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1 — CLUSTERING  (6:30AM UTC)                              │
│                                                                  │
│  SELECT last 12h raw_articles (status IN DONE, PARTIAL)          │
│  For each article:                                               │
│    1. extractEntities(title + description) — regex, no NLP lib  │
│    2. Load clusters: same category + updated_at > 24h ago       │
│    3. Find cluster where |entities ∩ cluster.entities| ≥ 2      │
│       AND hasHighSignalEntity(intersection)                      │
│    4. Match → append article_id, merge domains, merge entities   │
│       No match → INSERT new cluster                              │
│                                                                  │
│  Output: { articles_processed, clusters_updated,                 │
│            clusters_created, clusters_eligible }                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   clusters   │  (Supabase table)
                  │              │
                  │ status:      │
                  │  PENDING     │
                  │  PROCESSING  │
                  │  PROCESSED   │
                  │  FAILED      │
                  └──────┬───────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  PHASE 2 — SYNTHESIS  (6:45AM UTC)                               │
│                                                                  │
│  SELECT PENDING clusters (article_ids ≥ 2 AND unique_domains ≥ 2│
│    OR any article.authority_score ≥ 0.8)                         │
│                                                                  │
│  For each eligible cluster (parallel, up to 10):                 │
│    Pass 1 — Fact extraction per article:                         │
│      Input: title + description + content ≤500 words each       │
│      Output: [{ fact, type, source_count }]                      │
│    Pass 2 — Narrative generation from merged facts:              │
│      Output: { headline, summary, key_points, confidence_score } │
│                                                                  │
│    Quality gate: confidence_score ≥ 6                            │
│    River model: upsert story (merge if entity overlap > 24h)     │
│                                                                  │
│  Output: { clusters_processed, stories_written,                  │
│            stories_updated, clusters_failed }                    │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   stories    │  (Supabase table)
                  │              │
                  │ is_verified  │ ← manual gate initially
                  │ = false      │
                  └──────┬───────┘
                         │  20–50 high-quality stories/day
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  QUIZ GENERATION  (7:00 AM UTC — future wiring)                  │
│                                                                  │
│  generateDaily.js → sources from stories instead of raw_articles│
│  Passes: headline + summary + key_points to claude.js           │
│                                                                  │
│  NOTE: generateDaily wiring is OUT OF SCOPE for this pipeline.   │
│  stories table is purely additive in this phase.                 │
└─────────────────────────────────────────────────────────────────┘
```

### Full Daily Cron Order After This Feature

```
3:00AM  cleanup    — 7-day TTL
5:00AM  discover   — RSS → scrape_queue
6:00AM  process    — scrape_queue → raw_articles
6:30AM  cluster    — raw_articles → clusters      ← NEW
6:45AM  synthesize — clusters → stories           ← NEW
7:00AM  generate   — articles → questions (unchanged for now)
```

### What Changes vs. What Stays the Same

| Component | Status | Notes |
|-----------|--------|-------|
| `backend/jobs/generateDaily.js` | **Untouched** | Still sources from `articleStore.js` for now |
| `backend/services/articleStore.js` | **Untouched** | |
| `backend/services/claude.js` | **Untouched** | |
| `api/questions.js` | **Untouched** | |
| `api/complete.js` | **Untouched** | |
| Redis / Supabase question cache | **Untouched** | |
| `raw_articles` table | **Read only** | Clusterer reads; never writes |

---

## 4. Tech Stack

### New Dependencies

None. The pipeline uses:
- `@supabase/supabase-js` — already installed
- `@anthropic-ai/sdk` — already installed
- Regex-based entity extraction — no NLP library required

### Why No NLP Library?

Named-entity recognition libraries (compromise.js, natural, wink-nlp) add 5–30MB to the function bundle and require Node.js build steps. Our entity extraction goal is narrow: find proper nouns in headlines to cluster related articles. A regex matching 1–4 consecutive Title-Cased words followed by normalization achieves this without a dependency.

Tradeoff: misses entities in all-caps ("NATO", "EU") and multi-word proper nouns with lowercase connectors ("Queen of England"). Accepted — wire services use standard casing in headlines, and the ≥2 shared entity threshold compensates for extraction noise.

### Why Two Claude Passes Instead of One?

A single-pass prompt asking for "read these 5 articles and give me a synthesis" produces inconsistent results — Claude tends to anchor on the first article. Two passes enforce a structure:

1. **Pass 1** is mechanical: extract facts per article independently. The model has a narrow, repeatable task. Output is a structured list.
2. **Pass 2** is generative: compose a narrative from a pre-vetted fact list. The model works from clean input rather than raw article text.

This also isolates failure: if Pass 1 fails for one article, the remaining facts still produce a valid story.

### Why Supabase for clusters Table (Not Redis)?

Same reasoning as `scrape_queue`: durability and reprocessability are requirements. A failed cluster needs to be inspectable and retryable. Redis keys would be lost on eviction. The `clusters` table is also queryable for debugging (`SELECT ... WHERE status = 'FAILED'`).

---

## 5. Data Model

### Table: `clusters`

The durable representation of a story topic. Clusterer writes here. Synthesizer reads from here.

```sql
CREATE TABLE clusters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      text NOT NULL,
  primary_entities text[] NOT NULL DEFAULT '{}',
  -- Normalized entity union across all articles in this cluster

  article_ids      bigint[] NOT NULL DEFAULT '{}',
  -- raw_articles.id references (bigserial, NOT UUID)

  unique_domains   text[] NOT NULL DEFAULT '{}',
  -- Deduplicated source_domain list

  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
  -- Refreshed on every article append
);

CREATE INDEX clusters_status_idx   ON clusters(status);
CREATE INDEX clusters_category_idx ON clusters(category_id, updated_at DESC);
```

**Status lifecycle:**

```
PENDING → PROCESSING → PROCESSED
                    ↘ FAILED       (Claude API error after 2 retries)
FAILED → PENDING                   (manual reprocess: UPDATE status='PENDING')
```

**Eligibility for synthesis:**
- `array_length(article_ids, 1) ≥ 2` AND `array_length(unique_domains, 1) ≥ 2`
- OR any referenced article has `authority_score ≥ 0.8` (single-source exception for wire services)

---

### Table: `stories`

The synthesized, human-readable output. One story per cluster topic per day (upserted, not duplicated).

```sql
CREATE TABLE stories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id       UUID REFERENCES clusters(id),
  category_id      text NOT NULL,
  primary_entities text[] NOT NULL DEFAULT '{}',
  headline         text NOT NULL,
  summary          text NOT NULL,
  -- 50–75 words, neutral tone, present tense

  key_points       JSONB NOT NULL DEFAULT '[]',
  -- Array of 3–5 fact strings

  confidence_score int  NOT NULL DEFAULT 0,
  -- 1–10, synthesizer-assigned. Gate: must be ≥ 6 to write.

  is_verified      boolean NOT NULL DEFAULT false,
  -- Manual gate initially; automate after trust is established

  published_at     timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
  -- Refreshed on every re-synthesis (River model)
);

CREATE INDEX stories_category_idx ON stories(category_id, updated_at DESC);
CREATE INDEX stories_verified_idx ON stories(category_id, published_at DESC)
  WHERE is_verified = true AND confidence_score >= 6;
  -- Partial index: only rows eligible for quiz generation (future)
```

---

### Entity Normalization Rules (`backend/utils/nlp.js`)

Applied to every entity before comparison and storage.

```
1. Remove leading articles: "The", "A", "An"
2. Strip punctuation: commas, periods, quotes, parentheses
3. Normalize whitespace (collapse multiple spaces)
4. Convert to lowercase for comparison only (store original case)
5. Map equivalents:
     "U.S."          → "us"
     "United States" → "us"
     "U.K."          → "uk"
     "United Kingdom"→ "uk"
     "EU"            → "eu"
     "European Union"→ "eu"
```

**Entity extraction:** regex over `title + " " + description`

```
Pattern: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g
```

Matches 1–4 consecutive Title-Cased words. No external NLP dependency.

**High-signal heuristic:**

```
hasHighSignalEntity(entities): entity.length > 3 chars after normalization
```

Filters common false positives like "The", "In", "He", "Its".

---

### Cluster Matching Algorithm

```
Intersection = cluster.primary_entities ∩ article.entities  (normalized comparison)

Match conditions (both must hold):
  1. |Intersection| ≥ 2              (at least 2 shared entities)
  2. hasHighSignalEntity(Intersection) (at least one entity > 3 chars)

On match (River model):
  article_ids  = array_append(article_ids, article.id)
  unique_domains = array (deduplicated union)
  primary_entities = array (union, normalized)
  status = 'PENDING'  ← re-queued for re-synthesis
  updated_at = NOW()

On no match:
  INSERT new cluster with article as seed
```

Clusters with `updated_at < NOW() - 48h` are considered stale and skipped by synthesizer.

---

### Story River Model

The synthesizer does not blindly overwrite stories. It looks for an existing story before creating a new one:

```
Find existing story:
  WHERE category_id = cluster.category_id
    AND primary_entities && cluster.primary_entities  (array overlap operator)
    AND array_length(
          ARRAY(
            SELECT unnest(primary_entities)
            INTERSECT SELECT unnest(cluster.primary_entities)
          ), 1
        ) >= 2
    AND updated_at > NOW() - INTERVAL '24 hours'

If found → UPDATE:
  key_points   = deduplicated union of old + new key_points
  summary      = new summary (fresher synthesis wins)
  confidence_score = new score
  updated_at   = NOW()

If not found → INSERT new story
```

---

## 6. Component Design

### `backend/utils/nlp.js` — NLP Utilities

```
Exports:
  normalizeEntity(str) → string
    Apply normalization rules above

  extractEntities(text) → string[]
    Apply regex to text, normalize each match, deduplicate, return array

  hasHighSignalEntity(entities) → boolean
    Return true if any entity.length > 3 after normalization
```

### `backend/engine/clusterer.js` — Clustering Engine

```
Input:  none (reads from raw_articles + clusters)
Output: { articles_processed, clusters_updated, clusters_created, clusters_eligible }

Algorithm:
  1. SELECT raw_articles WHERE
       status IN ('DONE', 'PARTIAL')
       AND ingested_at > NOW() - INTERVAL '12 hours'
     -- only recent articles

  2. For each article:
     a. entities = extractEntities(article.title + ' ' + article.summary)
     b. Load active clusters:
          SELECT * FROM clusters
          WHERE category_id = article.category_id
            AND updated_at > NOW() - INTERVAL '24 hours'
     c. Find first cluster where match conditions hold
     d. If match → append + update (River model)
        If no match → INSERT new cluster

  3. Compute eligible clusters:
       article_ids.length ≥ 2 AND unique_domains.length ≥ 2
       OR any article has authority_score ≥ 0.8

  4. Return summary metrics

Error handling:
  - Per-article errors isolated — one bad article never aborts the run
  - DB errors logged with article.id for debugging
```

### `api/cron/cluster.js` — Cluster Cron Handler

```
Input:  GET/POST (Vercel Cron trigger)
Output: HTTP 200 + JSON metrics

Validates Vercel cron header (Authorization: Bearer ${CRON_SECRET})
Calls clusterer.run()
Logs structured JSON (see Observability)
Returns metrics
```

### `backend/engine/synthesizer.js` — Synthesis Engine

```
Input:  none (reads from clusters + raw_articles)
Output: { clusters_processed, stories_written, stories_updated, clusters_failed }

Algorithm:
  1. SELECT clusters WHERE
       status = 'PENDING'
       AND array_length(article_ids, 1) >= 2
       AND array_length(unique_domains, 1) >= 2
     LIMIT 50 per run

  2. For each cluster (parallel, up to 10 concurrent):
     a. Fetch article content:
          SELECT title, summary, content FROM raw_articles
          WHERE id = ANY(cluster.article_ids)

     b. Pass 1 — fact extraction per article:
          Prompt: extract structured facts from article
          Input: title + summary + content.slice(0, 500 words)
          Output: [{ fact, type: 'event|actor|number|statement', source_count }]

     c. Merge facts:
          Deduplicate by semantic similarity (exact string match only in MVP)
          Conflict resolution:
            - Numerical differences → report range ("3–5 casualties")
            - Conflicting statements → include both with attribution

     d. Pass 2 — narrative generation:
          Prompt: generate headline, summary, key_points, confidence_score
          Input: merged fact list + category_id
          Output: { headline, summary, key_points[3-5], confidence_score }

     e. Quality gate:
          if confidence_score < 6 → skip (log as LOW_CONFIDENCE)
          if key_points.length < 3 → skip

     f. River model upsert (see Data Model section)

     g. UPDATE cluster status = 'PROCESSED', updated_at = NOW()

  3. On Claude API error:
     Retry up to 2×, then UPDATE cluster status = 'FAILED', log error

  4. Return summary metrics

Model: claude-sonnet-4-20250514
Max concurrent clusters: 10 (p-limit)
maxDuration: 300s (Vercel Function)
```

**Pass 1 prompt structure:**

```
System: You are a fact extractor. Extract discrete facts from this news article.
        Return a JSON array only. Each fact: { "fact": string, "type": "event|actor|number|statement" }

User: Article title: {title}
      Article summary: {summary}
      Article content: {content_slice}
```

**Pass 2 prompt structure:**

```
System: You are a news editor. Given a list of verified facts from multiple sources,
        write a concise, neutral news story summary.
        Return JSON only: { "headline": string, "summary": string (50-75 words),
                            "key_points": string[3-5], "confidence_score": 1-10 }
        confidence_score: 1=speculative/single source, 10=confirmed by 5+ authoritative sources

User: Category: {category_id}
      Facts from {source_count} articles across {domain_count} domains:
      {merged_facts_json}
```

### `api/cron/synthesize.js` — Synthesize Cron Handler

```
Input:  GET/POST (Vercel Cron trigger)
Output: HTTP 200 + JSON metrics

Validates Vercel cron header
Calls synthesizer.run()
Logs structured JSON
Returns metrics
maxDuration: 300
```

---

## 7. Observability

### Structured Metrics (logged per cron run)

**Cluster cron:**
```json
{
  "event": "cluster_run",
  "timestamp": "2026-04-12T06:30:00Z",
  "articles_processed": 184,
  "clusters_updated": 23,
  "clusters_created": 11,
  "clusters_eligible": 28,
  "duration_ms": 4200
}
```

**Synthesize cron:**
```json
{
  "event": "synthesize_run",
  "timestamp": "2026-04-12T06:45:00Z",
  "clusters_processed": 28,
  "stories_written": 19,
  "stories_updated": 6,
  "clusters_failed": 3,
  "low_confidence_skipped": 2,
  "claude_calls": 56,
  "duration_ms": 47000
}
```

### Key Metrics to Watch

| Metric | Formula | Alert threshold |
|--------|---------|----------------|
| Clustering rate | `clusters_eligible / articles_processed` | < 0.10 (articles not clustering) |
| Synthesis success rate | `(stories_written + stories_updated) / clusters_processed` | < 0.70 |
| Stories per day | `SELECT COUNT(*) FROM stories WHERE published_at > NOW() - 24h` | < 20 |
| Claude failure rate | `clusters_failed / clusters_processed` | > 0.15 |
| Avg confidence score | `SELECT AVG(confidence_score) FROM stories WHERE published_at > NOW() - 24h` | — (informational) |

### Reprocessing

```sql
-- Retry all FAILED clusters
UPDATE clusters
SET status = 'PENDING'
WHERE status = 'FAILED';

-- Retry specific category
UPDATE clusters
SET status = 'PENDING'
WHERE status = 'FAILED' AND category_id = 'tech';

-- Inspect low-confidence stories
SELECT headline, confidence_score, category_id
FROM stories
WHERE confidence_score < 6
ORDER BY published_at DESC
LIMIT 20;
```

---

## 8. Product Safety

### Manual Verification Gate

All new stories enter with `is_verified = false`. They are not used by quiz generation (future wiring) until a human sets `is_verified = true`.

**Required for: first 2 weeks of operation.**

During this period:
1. Run both crons in shadow mode (not wired to `generateDaily`)
2. Review `stories` table in Supabase dashboard daily
3. Check: is the headline accurate? is the summary neutral? is it category-appropriate?
4. Bulk-approve high-confidence stories:
   ```sql
   UPDATE stories SET is_verified = true
   WHERE confidence_score >= 8
     AND published_at > NOW() - INTERVAL '24 hours';
   ```
5. After 2 weeks, automate approval for `confidence_score >= 7` from `unique_domains >= 3`

### Quality Gate Thresholds

| Gate | Threshold | Rationale |
|------|-----------|-----------|
| `confidence_score` | ≥ 6 | Mid-scale; filters speculative or thin stories |
| `article_ids` count | ≥ 2 | Minimum corroboration (two sources confirm event) |
| `unique_domains` count | ≥ 2 | Prevents echo-chamber single-publisher clusters |
| Single-source exception | `authority_score ≥ 0.8` | Reuters/AP/BBC breaking news before pickup |

### Conflict Resolution Policy

When facts from different articles contradict:
- **Numerical values** (death tolls, figures, prices): report as range — "between X and Y"
- **Factual claims** (what happened): include both versions attributed by source type ("reports suggest... while other sources indicate...")
- **Attribution unclear**: lower `confidence_score` by 1 for each unresolved conflict

This policy is encoded in the Pass 2 system prompt.

---

## 9. Drawbacks & Concerns

### 9.1 Entity Extraction Quality

**Problem:** Regex-based entity extraction misses entities in all-caps ("NATO", "IMF") and non-standard casing. It also over-matches common capitalized words at sentence starts.

**Mitigation:**
- The ≥2 entity threshold for clustering absorbs false positives — one noise match doesn't create a cluster
- Most wire service headlines use standard title casing for proper nouns
- Can extend equivalence map (`backend/utils/nlp.js`) for specific missed entities without changing architecture
- If false clustering becomes a problem in production, `hasHighSignalEntity` threshold can be raised from >3 to >5 chars

### 9.2 Claude Cost Scaling

**Problem:** At 50 clusters/day × 2 passes = 100 Claude calls/day. At peak (100 clusters), this becomes 200 calls. `claude-sonnet-4-20250514` is not free.

**Mitigation:**
- Cluster articles first (cheap) — only write eligible clusters to DB
- Cap synthesizer at 50 clusters per run
- Pass 1 inputs are short (~500 words per article × 3 articles = ~1500 tokens per cluster)
- Pass 2 input is the merged fact list (~500 tokens)
- Estimated cost: ~100 calls/day × ~2000 tokens avg = 200K tokens/day ≈ ~$0.30/day at Sonnet pricing
- Acceptable for MVP

### 9.3 synthesize Cron Duration

**Problem:** 50 clusters × 2 Claude passes with 10 concurrent = at least 10 rounds. Each round is ~2-3 API calls with latency. At 1s/call, worst case: 50 clusters ÷ 10 concurrent × 2 passes × 1.5s avg = ~15s. With retries and DB writes, realistic estimate: 60–120s.

**Mitigation:**
- `maxDuration: 300` on the Vercel Function (ample headroom)
- 15-minute gap between synthesize (6:45AM) and generate (7:00AM) provides buffer
- If cron runs long, adjust to 6:30AM synthesis

### 9.4 River Model Stale Clusters

**Problem:** A cluster from yesterday might get a new article appended today, re-queuing it for synthesis. The resulting story overwrites yesterday's story. This is intentional but could cause the updated_at timestamp to look misleading.

**Mitigation:**
- `published_at` is set once on INSERT (story's original publish time)
- `updated_at` reflects the last synthesis
- Future quiz generation should filter by `updated_at > NOW() - 24h` not `published_at`

### 9.5 Bootstrap / Day-One Problem

**Problem:** No clusters or stories exist on first deploy.

**Required sequence:**
1. Deploy cluster + synthesize crons without modifying `generateDaily.js`
2. Ensure `raw_articles` has at least 24h of data (RSS pipeline must be running)
3. Manually trigger cluster cron → inspect `clusters` table
4. Manually trigger synthesize cron → inspect `stories` table
5. Only wire `generateDaily.js` to `stories` in a future PR

---

## 10. Out of Scope for MVP

| Feature | Rationale for deferral |
|---------|----------------------|
| `generateDaily.js` wiring to `stories` | Shadow mode first — build trust in story quality before replacing article sourcing |
| Jaccard / embedding-based clustering | Regex entity overlap is sufficient for MVP; embeddings add cost and latency |
| Automated `is_verified` promotion | Manual gate for first 2 weeks |
| Cross-category story detection | A story about tech+finance exists in both — deferred |
| Story trend detection (rising/falling) | No time-series analysis in MVP |
| NLP library integration | Regex extraction is sufficient; revisit if clustering accuracy is poor |
| Story archiving/versioning | River model overwrites; full version history deferred to v3 |
| Category-aware synthesis tone | Structure defined, implementation optional |

---

## 11. Open Questions

| # | Question | Impact | Decision by |
|---|----------|--------|------------|
| Q1 | Should `confidence_score ≥ 6` gate be tunable via `config/flags.js`? | Tune without deploy | Set at implementation; flag if needed after first week |
| Q2 | Should stories with `is_verified = false` still be visible in a debug admin view? | Operations | Defer to v2 admin panel |
| Q3 | What happens when a story topic spans multiple categories (tech + finance)? | Story deduplication | Assign to primary category only; duplicate detection via `primary_entities` overlap |
| Q4 | Should the cluster cron run more frequently than 6:30AM for breaking news? | Freshness | Review after 2 weeks of data |
| Q5 | Should `unique_domains` threshold be 2 or 3? | Story volume | Start at 2 with single-source exception; tighten to 3 after volume is confirmed |

---

## Summary

| Dimension | Current (post-RSS pipeline) | Gold Set MVP |
|-----------|-----------------------------|-------------|
| Quiz source | Single `raw_article` per category | Synthesized `story` from ≥2 sources |
| Claude context | 500-char article slice | Structured fact list + summary |
| Cross-source validation | None | ≥2 domains per story required |
| Deduplication | URL-level only | Topic-level clustering |
| Story confidence | N/A | 1–10 confidence score, gate at 6 |
| Story persistence | Stateless (rebuilt each 7AM) | River model (updates throughout day) |
| Daily output | 5 questions from 5 articles | 20–50 stories → 5 quiz questions |
| New dependencies | None added | None (reuses existing SDK) |
| Claude call cost | ~5 calls/day | ~100 calls/day (~$0.30) |
| Observability | Per-question logs | Per-run structured metrics |
