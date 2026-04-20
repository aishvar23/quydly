# Geo Pipeline — Implementation Tracker

Extends the Azure queue pipeline with inline geo enrichment and a `story_audiences` projection table
so India users see region-relevant stories without forking ingestion, clustering, or synthesis.
Full design: [`docs/geo-pipeline-design.md`](docs/geo-pipeline-design.md)

**Branch:** `feature/geo-pipeline`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

**Core principle:** one global truth layer, many audience-specific ranking layers. No new queues, no new Azure Functions. All enrichment is inline in the existing `article-scraper`, `article-clusterer`, and `story-synthesizer` functions.

---

## Architecture (after this feature)

```
discover → scrape-queue → article-scraper
  │                         │ [+ geo enrichment inline]
  │                         └─ raw_articles
  │                              (+ source_country, source_region, language,
  │                                mentioned_geos, geo_scores, is_global_candidate)
  │
  │  article-clusterer (timer, every 2h)
  │    │ [+ geo aggregation inline]
  │    └─ clusters
  │         (+ primary_geos, geo_scores, source_countries)
  │              │
  │              └─ synthesize-queue → story-synthesizer
  │                                       │ [+ story geo + audience projection inline]
  │                                       │
  │                                       ├─ stories
  │                                       │    (+ primary_geos, geo_scores,
  │                                       │      global_significance_score)
  │                                       │
  │                                       └─ story_audiences  ← NEW TABLE
  │                                            (story_id, audience_geo, relevance_score,
  │                                             rank_bucket, rank_priority, reason)
  │
  └─ app: GET /api/questions?audience=india
            → selector reads story_audiences filtered by audience_geo
              ORDER BY rank_priority ASC, relevance_score DESC
              + 60/25/15 mix across rank_bucket (india) or top-N (global)
```

**Story-synthesizer processing contract (critical invariant):**
```
Step 1 Claude → Step 2 stories upsert → Step 3 story_audiences upserts
             → Step 4 UPDATE clusters SET status='PROCESSED' (LAST — commit point)
             → Step 5 complete SB message
```
Cluster is PROCESSED only after both `stories` AND every `story_audiences` row write succeed. Retries are safe because every write is idempotent (River-model natural key + `UNIQUE(story_id, audience_geo)`).

---

## Phase 1 — Feed Registry Enrichment

Enrich every entry in `azure-functions/lib/rss-feeds.js` with geo metadata. No pipeline behavior change yet — this is a code-only edit that feeds everything downstream.

| # | Task | Status |
|---|------|--------|
| 1.1 | Add `source_country`, `source_region`, `language`, `is_global_source` to every existing feed entry | ✅ |
| 1.2 | Add a module-level validation pass (throws on startup if any feed is missing the four fields) | ✅ |
| 1.3 | Add helper `lookupFeedByDomain(domain)` to `rss-feeds.js` (indexed lookup for scraper use) | ✅ |
| 1.4 | PR review: each feed's country/region assignment verified by a second person | ✅ |

**Feed entry shape after Phase 1:**
```js
{
  url: "...",
  domain: "bbc.com",
  category: "world",
  authority_score: 0.8,
  source_country:   "gb",           // ISO 3166-1 alpha-2, lowercase
  source_region:    "western_europe",
  language:         "en",
  is_global_source: true            // true for Reuters/AP/BBC World etc.
}
```

---

## Phase 2 — Add Indian-Origin RSS Feeds

Prerequisite to meaningful India relevance (called out in design doc §10.2). The current registry has zero India-origin feeds, so `source_country='in'` is always empty without this phase.

| # | Task | Status |
|---|------|--------|
| 2.1 | Research + add ~10 India-origin feeds (candidates: The Hindu, Hindustan Times, Economic Times, Indian Express, Mint/LiveMint, NDTV, Scroll, India Today, Moneycontrol, Times of India) | ✅ |
| 2.2 | Tag each with `source_country: "in"`, `source_region: "south_asia"`, `language: "en"`, `is_global_source: false` | ✅ |
| 2.3 | Map each feed to one of the existing category slugs (`world`, `tech`, `finance`, `culture`, `science`) | ✅ |
| 2.4 | Verify RSS feeds parse: `cd azure-functions && node -e "require('./lib/rss-feeds.js')"` + a smoke script that fetches each feed URL | ✅ |
| 2.5 | Deploy: feeds start flowing through `discover` on next 30-min tick | ⬜ |
| 2.6 | After 24h, spot-check `SELECT source_domain, COUNT(*) FROM raw_articles WHERE scraped_at > NOW() - INTERVAL '24 hours' GROUP BY 1 ORDER BY 2 DESC` — confirm Indian sources are ingesting | ⬜ |

---

## Phase 3 — Geo Gazetteer Module

Create `azure-functions/lib/geo.js` — hand-curated country/region alias lookup. No NLP dependency (matches the existing `nlp.js` regex-only philosophy).

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `azure-functions/lib/geo.js` — exports `AUDIENCES`, `GEO_ALIASES`, `REGIONS` | ✅ |
| 3.2 | Seed `GEO_ALIASES` for South Asia codes: `in`, `pk`, `bd`, `lk`, `np` | ✅ |
| 3.3 | Implement `extractMentionedGeos(text) → string[]` — lowercase + word-boundary regex, multi-word aliases matched before single-word | ✅ |
| 3.4 | Implement `mentionStrength(text, countryCode) → number` — returns `min(1.0, match_count × 0.25)` | ✅ |
| 3.5 | Implement `computeArticleAudienceScore(source_country, mentioned_geos, audience, text) → number` — the Article-level formula from design §7.1 | ✅ |
| 3.6 | Implement `computePrimaryGeos(member_geos) → string[]` — used by clusterer; geo is "primary" if ≥50% of articles mention it OR ≥2 articles are from that country | ✅ |
| 3.7 | Implement `computeClusterGeoScores(member_geos) → jsonb` — per-audience mean of article-level `geo_scores` | ✅ |
| 3.8 | Implement `computeAudienceProjection(story, cluster, audience) → { relevance_score, rank_bucket, rank_priority, reason }` — returns both the text bucket AND numeric priority (1/2/3/4), derived from same condition | ✅ |
| 3.9 | Unit test: seed a small set of articles, assert `extractMentionedGeos` returns expected codes for each | ✅ |
| 3.10 | Unit test: assert `computeAudienceProjection` never returns a `rank_bucket`/`rank_priority` pair that diverges from the fixed mapping (hero=1, standard=2, tail=3, filler=4) | ✅ |

---

## Phase 4 — Database Schema Additions

All additive. No existing column semantics change.

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `backend/db/migration_geo_pipeline.sql` with all ALTER/CREATE statements below | ✅ |
| 4.2 | Run migration in Supabase SQL editor | ✅ |
| 4.3 | Verify new columns visible on `raw_articles`, `clusters`, `stories`; verify `story_audiences` table + indexes | ✅ |

**Migration SQL:**
```sql
-- raw_articles
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS source_country text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS source_region text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS mentioned_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS is_global_candidate boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS raw_articles_geo_idx
  ON raw_articles USING gin (mentioned_geos);

-- clusters
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS primary_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS source_countries text[] NOT NULL DEFAULT '{}';

-- stories
ALTER TABLE stories ADD COLUMN IF NOT EXISTS primary_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS global_significance_score numeric(5,2) NOT NULL DEFAULT 0;

-- story_audiences (new)
CREATE TABLE IF NOT EXISTS story_audiences (
  id               bigserial PRIMARY KEY,
  story_id         bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  audience_geo     text NOT NULL,
  relevance_score  numeric(5,2) NOT NULL DEFAULT 0,
  rank_bucket      text NOT NULL DEFAULT 'standard'
                   CHECK (rank_bucket IN ('hero', 'standard', 'tail', 'filler')),
  rank_priority    smallint NOT NULL DEFAULT 2
                   CHECK (rank_priority BETWEEN 1 AND 4),
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, audience_geo)
);

CREATE INDEX IF NOT EXISTS story_audiences_feed_idx
  ON story_audiences (audience_geo, rank_priority, relevance_score DESC);

CREATE INDEX IF NOT EXISTS story_audiences_story_idx
  ON story_audiences (story_id);
```

---

## Phase 5 — `article-scraper`: Geo Enrichment Inline

Extend `azure-functions/article-scraper/index.js` to compute geo fields before `INSERT INTO raw_articles`.

| # | Task | Status |
|---|------|--------|
| 5.1 | Import `lookupFeedByDomain` from `rss-feeds.js`; copy source fields onto the article payload | ✅ |
| 5.2 | Compute `mentioned_geos = extractMentionedGeos(title + description + content[:2000])` | ✅ |
| 5.3 | Compute `geo_scores` map: `{ [audience]: computeArticleAudienceScore(...) }` for every entry in `AUDIENCES` | ✅ |
| 5.4 | Compute `is_global_candidate = is_global_source && mentioned_geos.length >= 2` | ✅ |
| 5.5 | Extend `INSERT INTO raw_articles` column list + `ON CONFLICT (url_hash) DO NOTHING` (idempotency preserved) | ✅ |
| 5.6 | Local smoke test: send 10 scrape-queue messages, verify `raw_articles.mentioned_geos` and `geo_scores` are populated | ✅ |
| 5.7 | Deploy to Function App | ⬜ |
| 5.8 | Monitor 24h: `SELECT COUNT(*) FILTER (WHERE 'in' = ANY(mentioned_geos)) FROM raw_articles WHERE scraped_at > NOW() - INTERVAL '24 hours'` — expect ≥ 10% of articles mention India once Indian feeds are live | ⬜ |
| 5.9 | Scraper latency check: compare p50/p95 invocation duration in App Insights against pre-change baseline — regression >5ms average is a yellow flag | ⬜ |

---

## Phase 6 — `article-clusterer`: Geo Aggregation

Extend `azure-functions/article-clusterer/index.js` to compute `primary_geos`, `geo_scores`, `source_countries` per cluster at INSERT/UPDATE time.

| # | Task | Status |
|---|------|--------|
| 6.1 | Extend article SELECT to also pull `mentioned_geos, source_country, geo_scores` from `raw_articles` | ✅ |
| 6.2 | Compute `source_countries = dedupe(member_geos.map(a => a.source_country).filter(Boolean))` — mirrors existing `unique_domains` derivation | ✅ |
| 6.3 | Compute `primary_geos = computePrimaryGeos(member_geos)` | ✅ |
| 6.4 | Compute `cluster.geo_scores = computeClusterGeoScores(member_geos)` | ✅ |
| 6.5 | Extend cluster INSERT + UPDATE to write `primary_geos`, `geo_scores`, `source_countries` | ✅ |
| 6.6 | No change to cluster-matching algorithm — geo is NOT a hard partition key | ✅ |
| 6.7 | Local smoke test: run clusterer against real unclustered articles, verify clusters have non-empty `primary_geos` and `source_countries` (`npm run test:clusterer` + `npm run test:clusterer:verify`) | ✅ |
| 6.8 | Deploy to Function App | ⬜ |
| 6.9 | Monitor 24h: `SELECT primary_geos, COUNT(*) FROM clusters WHERE updated_at > NOW() - INTERVAL '24 hours' GROUP BY 1` — expect varied distribution, not empty | ⬜ |
| 6.10 | Batch member-geo SELECT in chunks of 100 — keeps PostgREST URL length safe as PENDING clusters accumulate members | ✅ |

---

## Phase 7 — `story-synthesizer`: Geo Metadata + Audience Projection + Processing Contract

The critical phase. Extends `azure-functions/story-synthesizer/index.js`. Must implement the five-step processing contract exactly — `PROCESSED` is written last.

| # | Task | Status |
|---|------|--------|
| 7.1 | Add Step 0 idempotency check at top of function: if `cluster.status = 'PROCESSED'`, complete message and return (unchanged from existing design — preserved explicitly) | ⬜ |
| 7.2 | Implement `computeGlobalSignificance(cluster, synthesis)` per design §7.2 formula | ⬜ |
| 7.3 | Step 2 — extend story upsert: add `primary_geos`, `geo_scores`, `global_significance_score` to INSERT + ON CONFLICT UPDATE SET list | ⬜ |
| 7.4 | Step 3 — loop over `AUDIENCES` and upsert `story_audiences` row per audience. Must write `rank_bucket` AND `rank_priority` (derived from same condition in `computeAudienceProjection`) | ⬜ |
| 7.5 | Step 3 — ON CONFLICT (story_id, audience_geo) DO UPDATE SET `relevance_score`, `rank_bucket`, `rank_priority`, `reason`, `updated_at` | ⬜ |
| 7.6 | Step 4 — **move** `UPDATE clusters SET status='PROCESSED'` to AFTER the audience loop. This is the commit point — any earlier failure leaves status PENDING for retry | ⬜ |
| 7.7 | Step 5 — complete Service Bus message | ⬜ |
| 7.8 | Idempotency test: enqueue same `cluster_id` twice → verify exactly one `stories` row AND exactly N `story_audiences` rows (one per audience) | ⬜ |
| 7.9 | Partial-failure test: simulate exception between stories upsert and audience upserts → verify cluster remains PENDING, retry produces consistent final state (one story, full audience set) | ⬜ |
| 7.10 | Verify `UNIQUE (story_id, audience_geo)` constraint survives re-upsert stress (no duplicates after 10 replays of the same cluster) | ⬜ |
| 7.11 | Deploy to Function App | ⬜ |
| 7.12 | Monitor 24h: `SELECT audience_geo, COUNT(*) FROM story_audiences GROUP BY 1` — expect roughly equal counts per audience | ⬜ |

**Processing contract invariants (must hold):**
- Cluster `status = 'PROCESSED'` ⇒ story row exists AND every configured audience has a `story_audiences` row.
- Cluster `status = 'PENDING'` after a failed run ⇒ next SB delivery re-runs safely; every write is idempotent.
- No row in `story_audiences` without a parent `stories.id` (FK `ON DELETE CASCADE`).

---

## Phase 8 — Serving: API Audience Param + Selector Mix

Update the API + quiz generator to read from `story_audiences` when an audience is specified.

| # | Task | Status |
|---|------|--------|
| 8.1 | Add `audience` query parameter to `/api/questions` (default `global`); whitelist against `['india', 'global']`, fall back to `global` on unknown values | ⬜ |
| 8.2 | Update `backend/jobs/generateDaily.js` `pickStoriesForAudience(categoryId, audience)` — SELECT from `story_audiences` JOIN `stories`, `ORDER BY rank_priority ASC, relevance_score DESC` | ⬜ |
| 8.3 | Implement the 60/25/15 mix in the selector layer for India audience: 60% hero/standard with `'in' ∈ primary_geos`; 25% stories with high `global_significance_score` AND `'in' ∈ primary_geos`; 15% top `global_significance_score` stories not already picked | ⬜ |
| 8.4 | Expose the mix weights via `config/flags.js` → `FLAGS.audienceFeedMix` so they can be tuned without redeploy | ⬜ |
| 8.5 | Fallback path: if `story_audiences` has < N rows for the requested audience, fall back to `ORDER BY stories.story_score DESC` (preserves existing behavior on day one and during backfill) | ⬜ |
| 8.6 | Frontend: React Native client reads `Localization.region`, sends `audience=india` when region is `IN`, else omits (server default = global) | ⬜ |
| 8.7 | Backfill script: one-time `node azure-functions/scripts/backfill-story-audiences.js` — iterate stories from last 48h, recompute audience projections, upsert into `story_audiences` | ⬜ |

---

## Phase 9 — Observability

| # | Task | Status |
|---|------|--------|
| 9.1 | Add structured log event to article-scraper: `{ event: "article_geo_enriched", url_hash, source_country, mentioned_geos_count, geo_scores }` | ⬜ |
| 9.2 | Add structured log event to article-clusterer per cluster: `{ event: "cluster_geo_aggregated", cluster_id, primary_geos, source_countries, member_count }` | ⬜ |
| 9.3 | Add structured log event to story-synthesizer per audience row: `{ event: "story_audience_projected", story_id, audience_geo, rank_bucket, rank_priority, relevance_score, reason }` | ⬜ |
| 9.4 | Dashboard query: stories-per-day per audience (last 7 days) | ⬜ |
| 9.5 | Dashboard query: rank_bucket distribution per audience (sanity check — hero count should be meaningfully lower than standard) | ⬜ |
| 9.6 | Alert: `SELECT COUNT(*) FROM clusters WHERE status='PROCESSED' AND id NOT IN (SELECT cluster_id FROM stories)` — should be 0; any non-zero indicates the processing contract broke | ⬜ |

---

## Phase 10 — Cleanup + Docs

| # | Task | Status |
|---|------|--------|
| 10.1 | Update `CLAUDE.md` repo structure section: mention `azure-functions/lib/geo.js` and `story_audiences` table | ⬜ |
| 10.2 | Cross-link `docs/azure-queue-pipeline-design.md` and `docs/gold-set-pipeline-design.md` to the geo doc (brief note that synthesizer now writes audience rows) | ⬜ |
| 10.3 | Add a `config/flags.js` entry for `audienceFeedMix` (frontend flags) — keep pipeline scoring thresholds separate in `azure-functions/lib/flags.js` per CLAUDE.md rule #5 | ⬜ |
| 10.4 | Remove the Phase 8.5 fallback path once `story_audiences` has ≥ 7 days of history and coverage is confirmed | ⬜ |

---

## File Inventory

| Action | File | Phase |
|--------|------|-------|
| MODIFY | `azure-functions/lib/rss-feeds.js` — add geo fields to each feed; add `lookupFeedByDomain` helper | 1 |
| MODIFY | `azure-functions/lib/rss-feeds.js` — add ~10 Indian-origin feeds | 2 |
| CREATE | `azure-functions/lib/geo.js` — gazetteer, scoring helpers | 3 |
| CREATE | `backend/db/migration_geo_pipeline.sql` | 4 |
| MODIFY | `azure-functions/article-scraper/index.js` — inline geo enrichment | 5 |
| MODIFY | `azure-functions/article-clusterer/index.js` — geo aggregation per cluster | 6 |
| MODIFY | `azure-functions/story-synthesizer/index.js` — geo metadata + audience projection + moved PROCESSED to last step | 7 |
| MODIFY | `api/questions.js` — add `audience` query param | 8 |
| MODIFY | `backend/jobs/generateDaily.js` — audience-aware story selection | 8 |
| MODIFY | `config/flags.js` — add `audienceFeedMix` | 8, 10 |
| CREATE | `azure-functions/scripts/backfill-story-audiences.js` — one-time backfill | 8 |
| MODIFY | `frontend/screens/HomeScreen.jsx` (or API client) — send `audience` param | 8 |
| MODIFY | `CLAUDE.md` — updated repo structure | 10 |
| NO TOUCH | `azure-functions/discover/index.js` | — |
| NO TOUCH | `azure-functions/lib/clients.js` | — |
| NO TOUCH | `azure-functions/lib/nlp.js` | — |
| NO TOUCH | `azure-functions/lib/scoring.js` | — |
| NO TOUCH | Service Bus queues (no new queues) | — |
| NO TOUCH | Azure Function App topology (no new functions) | — |

---

## Environment Variables

No new env vars. Geo enrichment is deterministic code — no API keys, no external services. `AUDIENCES` is a constant exported from `lib/geo.js`.

---

## Rollback

**Before Phase 7:** enrichment writes are additive; scraper and clusterer can be reverted with a redeploy. New columns stay in the DB (no behavioral impact since they're read by nothing downstream yet).

**After Phase 7 but before Phase 8:** synthesizer can be reverted. `story_audiences` rows remain but are unused. App still reads from `stories` directly.

**After Phase 8:** if the audience-aware feed regresses user experience, flip `FLAGS.audienceFeedMix.enabled = false` to fall back to `ORDER BY stories.story_score DESC`. No redeploy of pipeline workers needed.

---

## Success Criteria

- India user's top 20 stories feed is qualitatively more India-relevant than the pre-change feed (human spot-check on at least 3 consecutive days).
- No regression in global-user feed quality: `global_significance_score`-ordered top stories match or exceed pre-change `story_score`-ordered lists on a sample review.
- No partial-write invariants violated: the observability query `clusters WHERE status='PROCESSED' AND id NOT IN (SELECT cluster_id FROM stories)` returns 0 for 7+ days.
- Scraper p95 latency does not regress by more than 10ms.
- Total Azure + Supabase cost delta: $0 (no new resources).
