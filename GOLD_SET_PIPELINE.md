# Gold Set Pipeline — Design Doc & Implementation Tracker

Transforms `raw_articles` into a continuously updating "Gold Set" of 20–50 high-quality, deduplicated, multi-source validated Stories per day.
Full spec: V1.6 High-Signal News Story Pipeline.

**Branch:** `feature/gold-set-pipeline`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

---

## What Is a Story?

A dynamic cluster of related articles distilled into a single factual, neutral narrative. Stories are the ground truth that quiz questions are generated from — they replace direct article sourcing and reduce noise from single-source or low-confidence news.

---

## Architecture

```
raw_articles (Supabase)
        ↓
[Phase 1] Clusterer  ← api/cron/cluster  (6:30AM UTC)
  entity extraction (regex, no NLP library)
  cluster matching: same category + ≥2 shared entities + ≥1 high-signal
  River model: append to existing cluster or create new
        ↓
clusters table (status: PENDING → PROCESSING → PROCESSED | FAILED)
        ↓
[Phase 2] Synthesizer  ← api/cron/synthesize  (6:45AM UTC)
  Pass 1: per-article fact extraction → merged fact list + source_count
  Pass 2: narrative generation → headline + summary + key_points + confidence_score
  River model: update existing story or insert new
        ↓
[Phase 3] Quality Gate (inside synthesizer)
  confidence_score ≥ 6 AND (≥3 articles OR any authority_score ≥ 0.8)
  is_verified = false (manual review initially)
        ↓
stories table  →  20–50 high-quality stories/day
        ↓
[future] generateDaily.js sources quiz questions from stories
```

**Full daily cron order after this feature:**
```
3:00AM  cleanup    — 7-day TTL
5:00AM  discover   — RSS → scrape_queue
6:00AM  process    — scrape_queue → raw_articles
6:30AM  cluster    — raw_articles → clusters      ← NEW
6:45AM  synthesize — clusters → stories           ← NEW
7:00AM  generate   — stories/articles → questions
```

---

## Data Model

### `clusters`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | gen_random_uuid() |
| category_id | text | matches raw_articles.category_id |
| primary_entities | text[] | normalized entity union across all articles |
| article_ids | bigint[] | raw_articles.id (bigserial, NOT UUID) |
| unique_domains | text[] | deduplicated domain list |
| status | text | PENDING · PROCESSING · PROCESSED · FAILED |
| created_at | timestamptz | |
| updated_at | timestamptz | refreshed on every append |

### `stories`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | gen_random_uuid() |
| cluster_id | UUID FK | references clusters.id |
| category_id | text | |
| primary_entities | text[] | |
| headline | text | |
| summary | text | 50–75 words, neutral tone |
| key_points | JSONB | array of 3–5 strings |
| confidence_score | int | 1–10, gate threshold = 6 |
| is_verified | boolean | false by default |
| published_at | timestamptz | |
| updated_at | timestamptz | refreshed on every re-synthesis |

---

## Phase 1 — Database Migration

| # | Task | Status |
|---|------|--------|
| 1.1 | Create `backend/db/migration_gold_set.sql` — clusters + stories tables | ⬜ |
| 1.2 | Run migration in Supabase SQL editor | ⬜ |
| 1.3 | Verify both tables + indexes appear in Supabase dashboard | ⬜ |

**SQL:**
```sql
CREATE TABLE clusters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      text NOT NULL,
  primary_entities text[] NOT NULL DEFAULT '{}',
  article_ids      bigint[] NOT NULL DEFAULT '{}',
  unique_domains   text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX clusters_status_idx       ON clusters(status);
CREATE INDEX clusters_category_idx     ON clusters(category_id, updated_at DESC);

CREATE TABLE stories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id       UUID REFERENCES clusters(id),
  category_id      text NOT NULL,
  primary_entities text[] NOT NULL DEFAULT '{}',
  headline         text NOT NULL,
  summary          text NOT NULL,
  key_points       JSONB NOT NULL DEFAULT '[]',
  confidence_score int  NOT NULL DEFAULT 0,
  is_verified      boolean NOT NULL DEFAULT false,
  published_at     timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX stories_category_idx ON stories(category_id, updated_at DESC);
```

---

## Phase 2 — NLP Utilities

| # | Task | Status |
|---|------|--------|
| 2.1 | Create `backend/utils/nlp.js` — normalizeEntity, extractEntities, hasHighSignalEntity | ⬜ |

**Entity normalization rules:**
- Remove leading articles: "The", "A", "An"
- Strip punctuation: commas, periods, quotes, parentheses
- Normalize whitespace
- Convert to lowercase for comparison
- Map equivalents: `"U.S." / "United States" → "us"`, `"U.K." / "United Kingdom" → "uk"`

**Entity extraction:** regex over title + description — match 1–4 consecutive Title-Cased words. No external NLP dependency.

**High-signal heuristic:** entity length > 3 chars (filters out common false positives like "The", "In", "He")

---

## Phase 3 — Clusterer

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `backend/engine/clusterer.js` | ⬜ |
| 3.2 | Create `api/cron/cluster.js` — Vercel Function handler | ⬜ |
| 3.3 | Add to `vercel.json`: `"30 6 * * *"` schedule for `/api/cron/cluster` | ⬜ |
| 3.4 | Smoke-test: call `/api/cron/cluster` manually, verify `clusters` table fills | ⬜ |
| 3.5 | Run twice — confirm River model updates existing clusters (no duplicates) | ⬜ |

**Algorithm:**
```
1. SELECT last 12h raw_articles (status IN DONE, PARTIAL)
2. For each article:
   a. entities = extractEntities(title + ' ' + description)
   b. Load clusters: same category_id, updated_at > NOW() - 24h
   c. Find cluster where |cluster.primary_entities ∩ entities| ≥ 2
      AND hasHighSignalEntity(intersection)
   d. If match → append article_id, merge domains, merge entities, status = PENDING
      If no match → INSERT new cluster
3. Clusters with article_ids < 2 OR unique_domains < 2 are not synthesized
```

**Output per run:** `{ articles_processed, clusters_updated, clusters_created, clusters_eligible }`

---

## Phase 4 — Synthesizer

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `backend/engine/synthesizer.js` — two-pass Claude API | ⬜ |
| 4.2 | Create `api/cron/synthesize.js` — Vercel Function handler | ⬜ |
| 4.3 | Add to `vercel.json`: `"45 6 * * *"` schedule, `maxDuration: 300` | ⬜ |
| 4.4 | Smoke-test: call `/api/cron/synthesize` manually, verify stories table fills | ⬜ |
| 4.5 | Verify River model: second run updates existing stories (merges key_points, refreshes summary) | ⬜ |
| 4.6 | Verify failed clusters are marked FAILED and logged | ⬜ |

**Two-pass synthesis:**

Pass 1 — Fact extraction per article (input: title + description + content ≤500 words each):
```json
[{ "fact": "...", "type": "event|actor|number|statement", "source_count": 2 }]
```
- Conflict resolution: numerical differences → report range; conflicting statements → include both

Pass 2 — Narrative generation (input: merged facts):
```json
{ "headline": "...", "summary": "50-75 words", "key_points": ["..."], "confidence_score": 7 }
```

**River model for stories:**
- Look for existing story: same category_id + ≥2 overlapping primary_entities + updated_at > 24h ago
- If found: merge key_points (deduplicate), refresh summary, updated_at = NOW()
- If not: INSERT new story

**Failure handling:** retry up to 2×, then mark cluster FAILED, log error

**Model:** `claude-sonnet-4-20250514` (reuses pattern from `backend/services/claude.js`)
**Estimated Claude calls:** ~50 clusters/day × 2 passes = ~100 calls/day

---

## Phase 5 — Quality Gate

| # | Task | Status |
|---|------|--------|
| 5.1 | Implement gate check inside synthesizer before story upsert | ⬜ |
| 5.2 | Verify 20–50 stories/day target met in Supabase after 24h run | ⬜ |

**Gate criteria (story is written only if):**
- `confidence_score ≥ 6`
- `array_length(article_ids) ≥ 3` OR any article has `authority_score ≥ 0.8`

All stories default to `is_verified = false`.

---

## Phase 6 — Deploy & Monitor

| # | Task | Status |
|---|------|--------|
| 6.1 | Deploy to Vercel (cron changes take effect immediately) | ⬜ |
| 6.2 | Monitor cluster cron run at 6:30AM — check logs | ⬜ |
| 6.3 | Monitor synthesize cron run at 6:45AM — check logs | ⬜ |
| 6.4 | Inspect `stories` table next morning — verify 20–50 rows | ⬜ |
| 6.5 | Spot-check 3 stories manually for factual coherence | ⬜ |

---

## File Inventory

| Action | File | Phase |
|--------|------|-------|
| CREATE | `backend/db/migration_gold_set.sql` | 1 |
| CREATE | `backend/utils/nlp.js` | 2 |
| CREATE | `backend/engine/clusterer.js` | 3 |
| CREATE | `api/cron/cluster.js` | 3 |
| CREATE | `backend/engine/synthesizer.js` | 4 |
| CREATE | `api/cron/synthesize.js` | 4 |
| MODIFY | `vercel.json` (2 new crons + maxDuration for synthesize) | 3/4 |
| NO TOUCH | `backend/services/claude.js` | — |
| NO TOUCH | `backend/jobs/generateDaily.js` | — |
| NO TOUCH | `backend/services/articleStore.js` | — |

---

## Rollback

Disable the two new crons in `vercel.json` → clustering and synthesis stop immediately.  
The `stories` and `clusters` tables are purely additive — removing them does not affect the existing quiz pipeline.
