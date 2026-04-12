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
    └─ River model: append to existing cluster or INSERT new

        ↓  durable queue
  clusters table
  status: PENDING → PROCESSING → PROCESSED | FAILED

        ↓  6:45AM — api/cron/synthesize.js
  synthesizer.js  (max 10 concurrent, maxDuration: 300s)
    ├─ Pass 1: fact extraction per article → merged fact list
    ├─ Pass 2: narrative generation → headline + summary + key_points + confidence_score
    ├─ Quality gate: confidence_score ≥ 6
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
| 1.1 | Create `backend/db/migration_gold_set.sql` — clusters + stories tables + indexes | ⬜ |
| 1.2 | Run migration in Supabase SQL editor | ⬜ |
| 1.3 | Verify both tables + indexes appear in Supabase dashboard | ⬜ |

**Tables:**
- `clusters` — cluster of related articles (primary_entities, article_ids, unique_domains, status)
- `stories` — synthesized narrative (headline, summary, key_points, confidence_score, is_verified)

**Status values:**
- `clusters`: PENDING → PROCESSING → PROCESSED | FAILED
- `stories`: no status field — quality gate is `confidence_score ≥ 6` + `is_verified`

---

## Phase 2 — NLP Utilities

| # | Task | Status |
|---|------|--------|
| 2.1 | Create `backend/utils/nlp.js` — `normalizeEntity`, `extractEntities`, `hasHighSignalEntity` | ⬜ |
| 2.2 | Unit test: verify entity normalization ("U.S." → "us", "United Kingdom" → "uk") | ⬜ |
| 2.3 | Unit test: verify extraction on 3 real news headlines | ⬜ |

**Entity extraction:** regex `/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g` — no external NLP lib
**High-signal:** `entity.length > 3` after normalization
**Equivalence map:** `"U.S." / "United States" → "us"`, `"U.K." / "United Kingdom" → "uk"`, `"EU" / "European Union" → "eu"`

---

## Phase 3 — Clusterer

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `backend/engine/clusterer.js` | ⬜ |
| 3.2 | Create `api/cron/cluster.js` — Vercel Function handler | ⬜ |
| 3.3 | Add to `vercel.json`: `"30 6 * * *"` schedule for `/api/cron/cluster` | ⬜ |
| 3.4 | Smoke-test: call `/api/cron/cluster` manually, verify `clusters` table fills | ⬜ |
| 3.5 | Run twice — confirm River model updates existing clusters (no duplicates) | ⬜ |

**Output per run:** `{ articles_processed, clusters_updated, clusters_created, clusters_eligible }`
**Eligibility:** `article_ids.length ≥ 2 AND unique_domains.length ≥ 2` OR any article `authority_score ≥ 0.8`

---

## Phase 4 — Synthesizer

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `backend/engine/synthesizer.js` — two-pass Claude API | ⬜ |
| 4.2 | Create `api/cron/synthesize.js` — Vercel Function handler | ⬜ |
| 4.3 | Add to `vercel.json`: `"45 6 * * *"` schedule, `maxDuration: 300` | ⬜ |
| 4.4 | Smoke-test: call `/api/cron/synthesize` manually, verify `stories` table fills | ⬜ |
| 4.5 | Verify River model: second run updates existing stories (merges key_points, refreshes summary) | ⬜ |
| 4.6 | Verify failed clusters are marked FAILED and logged | ⬜ |

**Model:** `claude-sonnet-4-20250514`
**Concurrency:** max 10 clusters in parallel (p-limit)
**Retry budget:** 2× per cluster before FAILED

---

## Phase 5 — Quality Gate

| # | Task | Status |
|---|------|--------|
| 5.1 | Implement gate check inside synthesizer before story upsert | ⬜ |
| 5.2 | Verify 20–50 stories/day target met in Supabase after 24h run | ⬜ |

**Gate criteria (story written only if):**
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
