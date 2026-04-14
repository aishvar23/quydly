# Gold Set Pipeline — Implementation Tracker

Transforms `raw_articles` into a continuously updating "Gold Set" of 20–50 high-quality, deduplicated, multi-source validated Stories per day.
Full design: [`docs/gold-set-pipeline-design.md`](docs/gold-set-pipeline-design.md)

**Branch:** `feature/gold-set-pipeline`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

---

## Architecture

```
raw_articles (Supabase)
        ↓  6:30AM — api/cron/cluster.js
  clusterer.js
    ├─ extractEntities(title + summary)  — regex, no NLP lib
    ├─ match: same category + ≥2 shared entities + hasHighSignalEntity
    ├─ River model: append to existing cluster or INSERT new
    └─ computeClusterScore → stored on cluster row
         gate: cluster_score ≥ 20 → eligible for synthesis (FLAGS.scoring.cluster.eligible)

        ↓  durable queue
  clusters table
  status: PENDING → PROCESSING → PROCESSED | FAILED
  cluster_score: (2×log(article_count+1)) + (3×domains) + (2×entities) + (2×recency)

        ↓  6:45AM — api/cron/synthesize.js
  synthesizer.js  (max 10 concurrent, maxDuration: 300s)
    ├─ SELECT WHERE cluster_score ≥ 20 AND article_ids ≥ 2 AND unique_domains ≥ 2
    ├─ Pass 1: fact extraction per article → [{ fact, type, source_count }]
    ├─ Pass 2: narrative → headline + summary + key_points + confidence_score
    ├─ Quality gates: confidence_score ≥ 6 AND key_points ≥ 3
    ├─ computeStoryScore → story_score, consistency_score, source_count
    │    story_score = (2×source) + (4×consistency×10) + (1×entity_clarity) + (2×confidence)
    │    ≥ 60 → publish candidate  |  35–60 → review  |  < 35 → reject
    └─ River model: upsert story (merge if entity overlap + updated_at < 24h)

        ↓  manual review (first 2 weeks)
  stories table — is_verified = true for trusted stories

        ↓  [future] generateDaily.js sources quiz questions from stories
```

**Cron order after this feature:**
```
3:00AM  cleanup    — 7-day TTL
5:00AM  discover   — RSS → scrape_queue
6:00AM  process    — scrape_queue → raw_articles
6:30AM  cluster    — raw_articles → clusters      ← NEW
6:45AM  synthesize — clusters → stories           ← NEW
7:00AM  generate   — articles → questions (unchanged for now)
```

**generateDaily wiring:** OUT OF SCOPE for this pipeline — `stories` table is additive only.

---

## Phase 1 — Database Migration

| # | Task | Status |
|---|------|--------|
| 1.1 | Create `backend/db/migration_gold_set.sql` — clusters + stories tables + indexes | ✅ |
| 1.2 | Run migration in Supabase SQL editor | ✅ |
| 1.3 | Verify both tables + indexes appear in Supabase dashboard | ✅ |

**`clusters` table columns:**
- `id`, `category_id`, `primary_entities text[]`, `article_ids bigint[]`, `unique_domains text[]`
- `cluster_score numeric(5,2) DEFAULT 0` — pre-LLM scoring gate (≥ 20 = eligible)
- `last_scored_at timestamptz` — updated on every scoring write
- `status text` — PENDING → PROCESSING → PROCESSED | FAILED
- `created_at`, `updated_at`

**`stories` table columns:**
- `id`, `cluster_id`, `category_id`, `primary_entities text[]`
- `headline`, `summary`, `key_points JSONB`
- `confidence_score int` — LLM output 1–10; gate: must be ≥ 6 to write
- `story_score numeric(5,2) DEFAULT 0` — post-LLM composite (≥ 60 publish, 35–60 review, < 35 reject)
- `consistency_score numeric(4,3) DEFAULT 0` — fraction of facts corroborated by ≥2 sources
- `source_count int DEFAULT 0` — unique articles in source cluster at synthesis time
- `is_verified boolean DEFAULT false`
- `published_at`, `updated_at`

**Status values:**
- `clusters`: PENDING → PROCESSING → PROCESSED | FAILED
- `stories`: no status field — quality gates are `confidence_score ≥ 6` + `story_score` disposition + `is_verified`

---

## Phase 2 — NLP Utilities

| # | Task | Status |
|---|------|--------|
| 2.1 | Create `backend/utils/nlp.js` — `normalizeEntity`, `extractEntities`, `hasHighSignalEntity` | ✅ |
| 2.2 | Unit test: verify entity normalization ("U.S." → "us", "United Kingdom" → "uk") | ✅ |
| 2.3 | Unit test: verify extraction on 3 real news headlines | ✅ |
| 2.4 | Review: incorporate nlp.js review findings (critical + high severity) | ✅ |
| 2.5 | Follow-up: tighten `hasHighSignalEntity`; fix dead ranking branch | ✅ |

**Review applied (2026-04-14):** All critical and high issues incorporated. Follow-up tightening applied same day.

**Entity extraction:** two-pass regex — title-case phrases + all-caps acronyms (`WHO`, `NATO`, `U.S.`) — no external NLP lib
**Cleaning:** `cleanEntity` helper strips leading/trailing punctuation, removes leading articles (`The/A/An`), normalises whitespace — runs before lowercasing in `normalizeEntity`
**High-signal:** two rules only — multi-word entity OR explicit membership in `HIGH_SIGNAL_SINGLES` (curated set: `nato`, `who`, `fbi`, `cia`, `us`, `uk`, `eu`, `ai`, etc.). Length is not used as a proxy.
**Stop-entity filter:** weekdays + generic publishing words (`breaking`, `news`, `update`, etc.) removed after normalization
**Overlap resolution:** shorter entity dropped when it is a strict substring of a longer retained entity (`New York` ⊂ `New York Times`)
**Output cap:** top 10 entities returned, ranked by word count then length (no acronym-aware tier — case is lost after normalization)
**Equivalence map:** `"U.S." / "u.s" / "United States" → "us"`, `"U.K." / "u.k" / "United Kingdom" → "uk"`, `"EU" / "European Union" → "eu"`
**Tests (50/50):** normalizeEntity (equivalence + cleaning), hasHighSignalEntity (multi-word, curated acronyms, unknown singles correctly false), extractEntities (title-case, all-caps acronyms, stop filtering, overlap resolution, output cap)

---

## Phase 3 — Scoring Utilities

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `backend/utils/scoring.js` — `computeClusterScore`, `clusterDisposition`, `computeStoryScore`, `storyDisposition` | ✅ |
| 3.2 | Unit test: `computeClusterScore` — verify log scaling, recency tiers, weighted sum | ✅ |
| 3.3 | Unit test: `clusterDisposition` — verify threshold boundaries | ✅ |
| 3.4 | Unit test: `computeStoryScore` — verify entity penalty (< 2 → 0, > 6 → cap), consistency ratio | ✅ |
| 3.5 | Unit test: `storyDisposition` — verify threshold boundaries | ✅ |
| 3.6 | Review: incorporate scoring.js + canonicalise.js review findings | ✅ |

**Review applied (2026-04-14):** All critical/high issues incorporated.

**`computeClusterScore(cluster)` formula:**
```
article_count_score = log(article_ids.length + 1)
domain_score        = unique_domains.length
entity_count_score  = primary_entities.length          ← renamed from entity_density_score
recency_score       = 1.0 / 0.7 / 0.4 / 0.1  (6h / 12h / 24h / older)
                      falls back to 0.1 on null or invalid timestamp

cluster_score = (2 × article_count_score) + (3 × domain_score)
              + (2 × entity_count_score) + (2 × recency_score)
```
**`clusterDisposition`:** thresholds from `FLAGS.scoring.cluster` — ≥ 20 → eligible · ≥ 12 → optional · < 12 → discard
(recalibrated from 8/5 — old values let almost any cluster pass)

**`computeStoryScore(cluster, synthesisResult)` formula:**
```
source_count      = new Set(cluster.article_ids).size   ← deduplicated
consistency_score = (facts with source_count ≥ 2).length / facts.length
entity_score      = clamp(primary_entities.length, 0 if <2, max 6 if >6)
confidence_score  = clamp(synthesisResult.confidence_score, 0–10)
                    defaults to 0 if missing, null, NaN, or non-finite

story_score = (2 × source_count) + (4 × consistency_score × 10)
            + (1 × entity_score) + (2 × confidence_score)
```
**Returns:** `{ story_score, consistency_score, source_count }`
**`storyDisposition`:** thresholds from `FLAGS.scoring.story` — ≥ 60 → publish · ≥ 35 → review · < 35 → reject
(recalibrated from 12/8 — old values made virtually everything a publish candidate)

**Thresholds live in `FLAGS.scoring` (config/flags.js)** — tune without code changes.

---

## Phase 4 — Clusterer

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `backend/engine/clusterer.js` | ✅ |
| 4.2 | Create `api/cron/cluster.js` — Vercel Function handler | ✅ |
| 4.3 | Add to `vercel.json`: `"30 6 * * *"` schedule for `/api/cron/cluster` | ✅ |
| 4.4 | Call `computeClusterScore` after every INSERT or UPDATE; write `cluster_score` + `last_scored_at` | ✅ |
| 4.5 | Smoke-test: call `/api/cron/cluster` manually, verify `clusters` table fills with `cluster_score` populated | ⬜ |
| 4.6 | Run twice — confirm River model updates existing clusters (no duplicates, score recalculated) | ⬜ |
| 4.7 | Spot-check: verify clusters with `cluster_score < 5` are not queued for synthesis | ⬜ |

**Output per run:** `{ articles_processed, clusters_updated, clusters_created, clusters_eligible }`
**Eligibility for synthesis:** `cluster_score ≥ 20` (FLAGS.scoring.cluster.eligible) AND `article_ids.length ≥ 2` AND `unique_domains.length ≥ 2` OR any article `authority_score ≥ 0.8`

---

## Phase 5 — Synthesizer

| # | Task | Status |
|---|------|--------|
| 5.1 | Create `backend/engine/synthesizer.js` — two-pass Claude API | ⬜ |
| 5.2 | Create `api/cron/synthesize.js` — Vercel Function handler | ⬜ |
| 5.3 | Add to `vercel.json`: `"45 6 * * *"` schedule, `maxDuration: 300` | ⬜ |
| 5.4 | SELECT query filters: `cluster_score ≥ 20` AND `article_ids ≥ 2` AND `unique_domains ≥ 2`, LIMIT 50 | ⬜ |
| 5.5 | Pass 1: fact extraction per article — output `[{ fact, type, source_count }]` | ⬜ |
| 5.6 | Pass 2: narrative generation — output `{ headline, summary, key_points, confidence_score }` | ⬜ |
| 5.7 | Call `computeStoryScore`; write `story_score`, `consistency_score`, `source_count` to story row | ⬜ |
| 5.8 | Apply `storyDisposition`: skip write if reject, log `LOW_STORY_SCORE`; log `LOW_CONFIDENCE` if confidence < 6 | ⬜ |
| 5.9 | Smoke-test: call `/api/cron/synthesize` manually, verify `stories` table fills with scores populated | ⬜ |
| 5.10 | Verify River model: second run updates existing stories (merges key_points, refreshes summary + scores) | ⬜ |
| 5.11 | Verify failed clusters are marked FAILED and logged with cluster.id + prompt payload | ⬜ |

**Model:** `claude-sonnet-4-20250514`
**Concurrency:** max 10 clusters in parallel (p-limit)
**Retry budget:** 2× per cluster before FAILED

---

## Phase 6 — Quality Gate Validation

| # | Task | Status |
|---|------|--------|
| 6.1 | Confirm `confidence_score < 6` stories are never written (logged as `LOW_CONFIDENCE`) | ⬜ |
| 6.2 | Confirm `storyDisposition = 'reject'` stories are never written (logged as `LOW_STORY_SCORE`) | ⬜ |
| 6.3 | Confirm `storyDisposition = 'review'` stories are written with `is_verified = false` and flagged for review | ⬜ |
| 6.4 | Confirm `storyDisposition = 'publish'` stories are written with `is_verified = false` as publish candidates | ⬜ |
| 6.5 | Verify 20–50 stories/day target met in Supabase after 24h run | ⬜ |
| 6.6 | Check `consistency_score` and `source_count` populated on every written story row | ⬜ |

**Gate criteria (story written only if ALL pass):**
- `confidence_score ≥ 6` (LLM confidence gate)
- `key_points.length ≥ 3` (narrative completeness gate)
- `storyDisposition(story_score) !== 'reject'` (scoring gate — rejects below FLAGS.scoring.story.review)

All stories default to `is_verified = false`.

---

## Phase 7 — Deploy & Monitor

| # | Task | Status |
|---|------|--------|
| 7.1 | Deploy to Vercel (cron changes take effect immediately) | ⬜ |
| 7.2 | Monitor cluster cron at 6:30AM — verify `cluster_score` populated, eligible count reasonable | ⬜ |
| 7.3 | Monitor synthesize cron at 6:45AM — verify `story_score`, `consistency_score`, `source_count` populated | ⬜ |
| 7.4 | Inspect `stories` table next morning — verify 20–50 rows, check score distribution | ⬜ |
| 7.5 | Spot-check 3 stories manually for factual coherence | ⬜ |
| 7.6 | Review `LOW_STORY_SCORE` and `LOW_CONFIDENCE` log entries — tune thresholds if reject rate > 30% | ⬜ |

---

## File Inventory

| Action | File | Phase |
|--------|------|-------|
| CREATE | `backend/db/migration_gold_set.sql` | 1 |
| CREATE | `backend/utils/nlp.js` | 2 |
| CREATE | `backend/utils/scoring.js` | 3 |
| CREATE | `backend/engine/clusterer.js` | 4 |
| CREATE | `api/cron/cluster.js` | 4 |
| CREATE | `backend/engine/synthesizer.js` | 5 |
| CREATE | `api/cron/synthesize.js` | 5 |
| MODIFY | `vercel.json` (2 new crons + maxDuration for synthesize) | 4/5 |
| NO TOUCH | `backend/services/claude.js` | — |
| NO TOUCH | `backend/jobs/generateDaily.js` | — |
| NO TOUCH | `backend/services/articleStore.js` | — |

---

## Rollback

Disable the two new crons in `vercel.json` → clustering and synthesis stop immediately.
The `stories` and `clusters` tables are purely additive — removing them does not affect the existing quiz pipeline.
