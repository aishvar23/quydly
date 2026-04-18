# Design Document: Geo-Aware Pipeline Extension

**Feature:** Extend the Azure queue pipeline with geo enrichment and audience-specific feed projection so India users see India-relevant stories without fragmenting the shared ingestion, clustering, or synthesis pipeline.
**Branch:** `feature/geo-pipeline`
**Status:** Design v1 — for review
**Authors:** Aishvarya Suhane

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Core Principle](#3-core-principle)
4. [Proposed Architecture](#4-proposed-architecture)
5. [Schema Changes](#5-schema-changes)
6. [Component Design](#6-component-design)
7. [Scoring System](#7-scoring-system)
8. [Serving Model](#8-serving-model)
9. [Rollout Plan](#9-rollout-plan)
10. [Drawbacks & Concerns](#10-drawbacks--concerns)
11. [Out of Scope for MVP](#11-out-of-scope-for-mvp)
12. [Open Questions](#12-open-questions)

---

## 1. Problem Statement

The Azure queue pipeline (see [`azure-queue-pipeline-design.md`](./azure-queue-pipeline-design.md)) synthesizes 20–50 stories/day from a global RSS registry. Ranking is by `story_score` alone, which measures intrinsic quality — corroboration, entity clarity, LLM confidence — but has **no signal about audience relevance**.

Observed impact: when the Gold Set is shown to a user in India, the majority of stories are US/UK/EU-centric (a US Fed rate decision, a UK parliamentary vote, a Hollywood awards story). These can be high-quality global stories, but they are not what an India user expects from a daily news quiz. Relevance, not quality, is the gap.

**Naive fix (rejected):** fork the pipeline by geo — separate `scrape-queue-in`, `scrape-queue-global`, separate clusterers and synthesizers. This duplicates work, creates two clusters for the same global event (e.g. a G20 summit clustered once in the India pipeline and once in the global pipeline), and scales O(N) in geos.

**Correct fix:** keep one global truth layer (ingest → cluster → synthesize), then add an audience projection layer that ranks the same canonical stories differently per geo.

---

## 2. Goals & Non-Goals

### Goals

1. India users see a feed where the majority of stories are India or South Asia relevant.
2. Global users continue to see highest-significance global stories.
3. One shared ingestion, clustering, and synthesis path — no duplicated scrape or Claude calls per geo.
4. The set of supported audiences is extensible (add `uk`, `us`, `eu` later without schema churn).
5. A single story that is globally significant AND India-relevant surfaces in both feeds, not as two records.

### Non-Goals

- **No separate scrape queues per geo.** `scrape-queue` remains singular.
- **No separate clusterers per geo.** Clustering is still timer-driven over all unclustered articles.
- **No separate synthesizers per geo.** One `stories` row per canonical event cluster.
- **No duplication of the Gold Set into per-geo story tables.**
- **No per-user personalization in MVP.** Audience is geo-coarse (`india`, `global`) — user-level personalization is v2.

---

## 3. Core Principle

> **One global truth layer. Many audience-specific ranking layers.**

The pipeline ingests, deduplicates, and synthesizes once. The `stories` table remains the canonical source of truth. A new `story_audiences` projection table holds per-geo relevance scores derived from story metadata. App requests fetch from `story_audiences` filtered by the caller's geo.

```
Ingest → Cluster → Synthesize            (global, shared, unchanged)
                         ↓
                     stories              (canonical, one row per event)
                         ↓
              story_audiences              (projection: N rows per story,
                                            one per audience geo)
                         ↓
           App: GET /api/questions?geo=india
```

---

## 4. Proposed Architecture

### 4.1 Pipeline Diff

```
BEFORE (current Azure queue pipeline):
  discover → scrape-queue → article-scraper
      → raw_articles
          → article-clusterer (timer, every 2h)
              → clusters → synthesize-queue → story-synthesizer
                  → stories
                      → app serves ordered by story_score

AFTER (geo-aware):
  discover → scrape-queue → article-scraper
      → raw_articles  [+ geo enrichment, inline in scraper]
          → article-clusterer (timer, every 2h)
              → clusters  [+ geo aggregation, inline]
                  → synthesize-queue → story-synthesizer
                      → stories  [+ primary_geos, geo_scores, global_significance_score]
                          → story_audiences  [projection, written by story-synthesizer]
                              → app serves filtered by audience_geo, ordered by relevance_score
```

**No new Azure Functions. No new queues. No new timers.** Each enrichment step is inline in the existing function that writes its parent record.

### 4.2 Where each step runs

| Step | Host | When it runs |
|---|---|---|
| Source geo metadata | `azure-functions/lib/rss-feeds.js` (static) | Compile-time |
| Article geo enrichment | `article-scraper` (inline) | Per message, before `INSERT INTO raw_articles` |
| Cluster geo aggregation | `article-clusterer` (inline) | Per cluster INSERT/UPDATE, from member articles |
| Story geo metadata | `story-synthesizer` (inline) | During story upsert, copied from cluster |
| Global significance score | `story-synthesizer` (inline) | Post-synthesis, before upsert |
| Audience projection | `story-synthesizer` (inline) | After story upsert, one INSERT per configured audience |

Inlining is the deliberate choice. Splitting enrichment into a separate queue/function would re-introduce coordination overhead (ordering, idempotency, retries) for a computation that is cheap and deterministic. Geo enrichment adds ~1–5ms per record — far below the scraper's network-bound cost.

---

## 5. Schema Changes

All additions are additive and idempotent. No existing column semantics change.

### 5.1 Feed registry (static, in code)

The current registry is `azure-functions/lib/rss-feeds.js` — a JavaScript const array. For MVP we **extend the object shape** rather than introduce a DB table. This keeps source-of-truth in code (reviewable via PR, no migration needed) and matches the "two flags files, separate concerns" rule in CLAUDE.md.

```js
// azure-functions/lib/rss-feeds.js
{
  url: "...",
  domain: "...",
  category: "world",
  authority_score: 0.8,

  // NEW — geo metadata
  source_country:  "in",       // ISO 3166-1 alpha-2, lowercase
  source_region:   "south_asia",
  language:        "en",
  is_global_source: false      // true for Reuters/AP/BBC World — covers multiple geos
}
```

Every entry must have `source_country`, `source_region`, `language`. `is_global_source` defaults to false; set true for publishers whose audience is not regionally bound (e.g. Reuters, AP, BBC World Service).

A migration to a DB-backed `feed_registry` table is a v2 concern — deferred because we have ~50 feeds and the current JS module is edited via PR.

### 5.2 `raw_articles`

```sql
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS source_country text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS source_region text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS mentioned_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS is_global_candidate boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS raw_articles_geo_idx
  ON raw_articles USING gin (mentioned_geos);
```

**Semantics:**
- `source_country`, `source_region`, `language`: copied from the feed registry at scrape time.
- `mentioned_geos text[]`: country/region codes explicitly referenced in `title + description` (plus `content` if available).
- `geo_scores jsonb`: `{ "in": 0.85, "global": 0.2 }` — per-audience relevance score, 0.0–1.0.
- `is_global_candidate`: true when the article is both from a `is_global_source` feed AND has `mentioned_geos.length >= 2`.

### 5.3 `clusters`

```sql
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS primary_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
```

Derived from member articles at each cluster INSERT/UPDATE — never a hard partition key, only metadata.

### 5.4 `stories`

```sql
ALTER TABLE stories ADD COLUMN IF NOT EXISTS primary_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS global_significance_score numeric(5,2) NOT NULL DEFAULT 0;
```

`global_significance_score` is kept separate from any per-audience score. It answers: "how globally significant is this story on its own merits?" — used as the ordering key for the global feed.

### 5.5 `story_audiences` (new table)

```sql
CREATE TABLE IF NOT EXISTS story_audiences (
  id               bigserial PRIMARY KEY,
  story_id         bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  audience_geo     text NOT NULL,
  -- 'india' | 'global' in V1; extensible to 'uk', 'us', 'eu', etc.

  relevance_score  numeric(5,2) NOT NULL DEFAULT 0,
  rank_bucket      text NOT NULL DEFAULT 'standard'
                   CHECK (rank_bucket IN ('hero', 'standard', 'tail', 'filler')),
  -- Coarse-grained ordering layer above raw score. Lets the serving layer mix buckets
  -- deterministically (e.g. always lead with a hero) without re-sorting on every request.

  reason           text,
  -- Human-readable one-liner: "India-origin source + India-entity mention"
  -- Useful for debugging surprising rankings; nullable.

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (story_id, audience_geo)
);

CREATE INDEX IF NOT EXISTS story_audiences_feed_idx
  ON story_audiences (audience_geo, relevance_score DESC);

CREATE INDEX IF NOT EXISTS story_audiences_story_idx
  ON story_audiences (story_id);
```

**Cardinality:** for 50 stories/day × 2 audiences = 100 rows/day. At 7-day retention (aligned with existing `cleanup` cron), the table stays under ~1000 rows. No partitioning needed.

**On story re-synthesis (River model):** the story-synthesizer upserts into `story_audiences` per audience. `ON CONFLICT (story_id, audience_geo) DO UPDATE SET relevance_score = EXCLUDED.relevance_score, rank_bucket = EXCLUDED.rank_bucket, reason = EXCLUDED.reason, updated_at = NOW()`.

---

## 6. Component Design

### 6.1 Geo gazetteer — `azure-functions/lib/geo.js` (new)

A small, hand-curated lookup module. No external NLP dependency — matches the existing `nlp.js` regex-only philosophy.

```js
// Exports (sketch)
export const AUDIENCES = ['india', 'global'];

// Country code → { region, aliases: [names, demonyms, major cities/states] }
export const GEO_ALIASES = {
  in: {
    region: 'south_asia',
    aliases: [
      'india', 'indian', 'mumbai', 'delhi', 'new delhi', 'bangalore',
      'bengaluru', 'chennai', 'kolkata', 'hyderabad', 'pune', 'ahmedabad',
      'kerala', 'tamil nadu', 'karnataka', 'maharashtra', 'uttar pradesh',
      'bjp', 'congress party', 'modi', 'rupee', 'sensex', 'nifty',
      // curated — not exhaustive, not meant to be
    ]
  },
  pk: { region: 'south_asia', aliases: ['pakistan', 'pakistani', 'islamabad', 'karachi', 'lahore'] },
  bd: { region: 'south_asia', aliases: ['bangladesh', 'dhaka'] },
  // ... extend as needed
};

// Map region → list of country codes (used for cluster-level aggregation)
export const REGIONS = {
  south_asia: ['in', 'pk', 'bd', 'lk', 'np'],
  // ...
};

// Core functions:
export function extractMentionedGeos(text) { /* returns ['in', 'pk'] etc. */ }
export function mentionStrength(text, countryCode) { /* returns 0.0–1.0 */ }
```

**Mention extraction:** lowercase, word-boundary regex matches against each country's alias list. Deduplicate by country code. Multi-word aliases (e.g. "new delhi", "tamil nadu") are matched before single-word aliases to avoid false "delhi" splits.

**Mention strength:** rough proxy for "how much this article is about country X" — computed as `min(1.0, match_count × 0.25)` capped at 1.0. Three or more mentions saturate.

This approach will miss all-caps entities ("NATO", "ASEAN") and subtle regional framing. Accepted — same tradeoff as `nlp.js` entity extraction.

### 6.2 `article-scraper` — geo enrichment inline

Change to the existing scraper (steps added after fetch/parse, before INSERT):

```
...existing scrape logic through Readability parse...

6a. Geo enrichment:
    feed = lookupFeedByDomain(message.source_domain)
    source_country  = feed.source_country
    source_region   = feed.source_region
    language        = feed.language
    is_global_source = feed.is_global_source

    text = title + ' ' + (description ?? '') + ' ' + (content?.slice(0, 2000) ?? '')
    mentioned_geos = extractMentionedGeos(text)       // ['in', 'pk']

    // geo_scores: compute only for configured audiences
    geo_scores = {}
    for (const audience of AUDIENCES) {
      geo_scores[audience] = computeArticleAudienceScore(
        source_country, mentioned_geos, audience, text
      )
    }
    is_global_candidate = is_global_source && mentioned_geos.length >= 2

6b. INSERT INTO raw_articles (..., source_country, source_region, language,
                              mentioned_geos, geo_scores, is_global_candidate)
    ON CONFLICT (url_hash) DO NOTHING
```

**Determinism:** the same article produces the same `geo_scores` — no LLM, no network. Idempotency of the scraper is preserved.

### 6.3 `article-clusterer` — cluster geo aggregation

After each cluster INSERT or UPDATE:

```
// Aggregate primary_geos from member articles
member_geos = SELECT mentioned_geos, source_country
              FROM raw_articles WHERE id = ANY(cluster.article_ids)

// A geo is "primary" for a cluster if:
//   strong signal: >= 50% of articles mention it, OR
//   source evidence: >= 2 articles are from publishers in that country
primary_geos = computePrimaryGeos(member_geos)

// Cluster-level geo score: per-audience mean of article-level scores
cluster.geo_scores = computeClusterGeoScores(member_geos)

UPDATE clusters
   SET primary_geos = $primary_geos,
       geo_scores   = $geo_scores
 WHERE id = $cluster_id
```

No change to the clustering match algorithm — geo is **not** a hard partition key. A US source and an Indian source reporting the same G20 summit should still end up in one cluster.

### 6.4 `story-synthesizer` — story geo + audience projection

After the existing River-model upsert into `stories`:

```
// (a) Copy cluster-level geo metadata to the story row
UPDATE stories
   SET primary_geos = cluster.primary_geos,
       geo_scores   = cluster.geo_scores,
       global_significance_score = computeGlobalSignificance(cluster, synthesis)
 WHERE id = $story_id

// (b) Write per-audience projection rows (one INSERT ... ON CONFLICT per audience)
for (const audience of AUDIENCES) {
  const { relevance_score, rank_bucket, reason } =
    computeAudienceProjection(story, cluster, audience)

  INSERT INTO story_audiences (story_id, audience_geo, relevance_score, rank_bucket, reason)
  VALUES (...)
  ON CONFLICT (story_id, audience_geo) DO UPDATE SET
    relevance_score = EXCLUDED.relevance_score,
    rank_bucket     = EXCLUDED.rank_bucket,
    reason          = EXCLUDED.reason,
    updated_at      = NOW()
}
```

**Order of operations:** story upsert first (so `story_audiences.story_id` always has a target), then audience rows. Both are in the same Supabase client session — a failure between them is caught by synthesizer retry (Service Bus redelivers the message, idempotency check at top of synthesizer short-circuits if cluster is already PROCESSED).

**Idempotency contract:** if the synthesizer is re-invoked for the same cluster, `story_audiences` rows are re-upserted with fresh scores. This is intentional — scores should reflect current cluster state.

### 6.5 `generateDaily.js` — audience-aware quiz generation

The 7AM quiz generator currently selects stories ordered by `story_score`. Change:

```js
// backend/jobs/generateDaily.js (sketch — future wiring)
async function pickStoriesForAudience(categoryId, audience = 'global') {
  return supabase
    .from('story_audiences')
    .select('*, stories!inner(*)')
    .eq('audience_geo', audience)
    .eq('stories.category_id', categoryId)
    .eq('stories.is_verified', true)
    .order('relevance_score', { ascending: false })
    .limit(10)
}
```

**Serving mix for India** (per review spec):

| Bucket | Weight | Rule |
|---|---|---|
| India / South Asia relevant | 60% | `audience_geo='india' AND reason contains 'primary_geo'` |
| Global with India impact | 25% | `audience_geo='india' AND reason contains 'global_with_impact'` |
| Broad global | 15% | top `global_significance_score` not already in the feed |

This mix is implemented in the selection layer — not as separate tables. `rank_bucket` encodes which bucket a story qualifies for; the selector draws the configured proportions.

---

## 7. Scoring System

### 7.1 Article-level audience score (inputs to cluster/story scoring)

Computed in `article-scraper`. 0.0–1.0 per audience.

```
ArticleAudienceScore(article, 'india') =
    0.40 × (source_country == 'in' ? 1.0 : 0.0)
  + 0.35 × mention_strength('in' or south_asia country, article.text)
  + 0.15 × (source_region == 'south_asia' ? 1.0 : 0.0)
  + 0.10 × global_topic_with_india_hook

ArticleAudienceScore(article, 'global') =
    0.30 × (is_global_source ? 1.0 : 0.0)
  + 0.30 × entity_is_geopolitical   (NATO, G20, IMF, WHO, etc.)
  + 0.25 × multi_geo_mention        (>= 3 distinct countries mentioned)
  + 0.15 × authority_score
```

`global_topic_with_india_hook`: boolean — true when the story is on a globally-significant topic (AI regulation, climate summit, major markets) AND India is among the mentioned geos.

### 7.2 Story-level global significance score

Applied by story-synthesizer after Pass 2 output.

```
GlobalSignificanceScore(cluster, synthesis) =
    2 × (unique_domains count, capped at 6)           // broad pickup
  + 3 × (cluster.mentioned_geos diversity, capped at 5) // cross-geo resonance
  + 2 × (max authority_score among source articles)   // wire-service weight
  + 2 × synthesis.confidence_score / 10 × 10          // LLM confidence, 0–10
```

Stored on `stories.global_significance_score`. Used as the primary ordering key for the global feed.

**Separation from `story_score`:** `story_score` measures intrinsic story quality (consistency, entity clarity, confidence). `global_significance_score` measures global relevance (cross-geo pickup, wire-service pickup, entity span). A story can be high-quality but locally scoped — that's the signal we want to preserve.

### 7.3 Audience projection score

Per audience, per story. This is the ordering key for `story_audiences`.

```
AudienceGeoScore(story, cluster, 'india') =
    4 × mention_strength('in', aggregated across cluster articles)
  + 3 × (source_country == 'in' present in cluster.unique_domains)
  + 3 × ('in' ∈ cluster.primary_geos)
  + 2 × india_entity_density   (entities from GEO_ALIASES.in.aliases in primary_entities)
  + 2 × indian_publisher_support (count of distinct Indian domains / cluster.unique_domains.length)
  + 1 × global_significance_with_india_mention

AudienceGeoScore(story, cluster, 'global') =
    story.global_significance_score (re-used — already captures global signal)
```

**Rank bucket derivation** (deterministic from score):

| Rank bucket | Condition for `india` | Condition for `global` |
|---|---|---|
| `hero` | score ≥ 12 AND `'in' ∈ primary_geos` | `global_significance_score ≥ 14` |
| `standard` | score ≥ 7 | `global_significance_score ≥ 10` |
| `tail` | score ≥ 4 | `global_significance_score ≥ 6` |
| `filler` | else | else |

**`reason` field** (one-liner, hand-picked from a small enum for observability):

```
"india-origin source + india-entity mention"
"global story with india hook"
"south-asia regional event"
"wire-service pickup, multi-geo"
"global: high authority + multi-domain"
```

---

## 8. Serving Model

### 8.1 Audience determination

The app sends a geo hint on each request:

```
GET /api/questions?audience=india
```

V1: client reads its own locale (React Native `Localization.region`) and sends it. Server falls back to `global` for any unrecognized value. No IP geolocation — too noisy, too many edge cases (VPNs, travel).

V2 (out of scope): `user.preferred_audience` column, set from onboarding.

### 8.2 Feed composition

For an India user asking for the top 20 stories across categories:

```
SELECT sa.*, s.*
  FROM story_audiences sa
  JOIN stories s ON s.id = sa.story_id
 WHERE sa.audience_geo = 'india'
   AND s.is_verified = true
   AND s.updated_at > NOW() - INTERVAL '24 hours'
 ORDER BY sa.rank_bucket, sa.relevance_score DESC
```

The selector then applies the 60/25/15 mix across `rank_bucket` categories. Exact implementation is one SQL query + in-memory partitioning — no cross-table joins beyond `story_audiences → stories`.

### 8.3 Fallback

If `story_audiences` has fewer than N rows for an audience (e.g. first deploy, backfill incomplete), the selector falls back to ordering by `stories.story_score DESC` for that category. This preserves current behavior on day one.

---

## 9. Rollout Plan

### Phase 1 — Source geo metadata

1. Enrich every entry in `azure-functions/lib/rss-feeds.js` with `source_country`, `source_region`, `language`, `is_global_source`.
2. Add validation to a startup check: every feed must have all four fields (fail fast on missing).
3. No pipeline behavior change yet.

**Exit criteria:** all feeds tagged; PR review confirms correct geo assignment for each.

### Phase 2 — Raw article geo enrichment

1. Migration: add geo columns to `raw_articles` + GIN index on `mentioned_geos`.
2. Create `azure-functions/lib/geo.js` (gazetteer + `extractMentionedGeos` + scoring helpers).
3. Update `article-scraper` to compute and write geo fields inline.
4. Deploy. Monitor: `SELECT COUNT(*) FILTER (WHERE 'in' = ANY(mentioned_geos)) FROM raw_articles WHERE scraped_at > NOW() - INTERVAL '24 hours'` — expect a meaningful share (rough eyeball: 10–20%).
5. Spot-check 20 articles flagged `'in' ∈ mentioned_geos` for correctness.

**Exit criteria:** enrichment stable for 48h; no scraper latency regression (>5ms average is a yellow flag).

### Phase 3 — Cluster and story geo metadata

1. Migration: add geo columns to `clusters` and `stories`.
2. Update `article-clusterer` to compute `primary_geos`, `geo_scores` per cluster.
3. Update `story-synthesizer` to copy cluster geo metadata to story + compute `global_significance_score`.
4. Deploy. Monitor: `SELECT primary_geos, COUNT(*) FROM clusters WHERE updated_at > NOW() - INTERVAL '24 hours' GROUP BY 1`.

**Exit criteria:** clusters and stories have non-empty `primary_geos` for a meaningful share of records.

### Phase 4 — Audience projection

1. Migration: create `story_audiences` table + indexes.
2. Update `story-synthesizer` to upsert per-audience rows (`india`, `global`).
3. Backfill: one-time script to generate `story_audiences` rows for stories in the last 24h.
4. Deploy. Spot-check: pull top 10 stories for `audience_geo='india'` and verify human judgment agrees the list is India-relevant.

**Exit criteria:** both `india` and `global` audiences return sensible top-10 lists; no duplicate `(story_id, audience_geo)` rows.

### Phase 5 — App ranking update

1. Add `audience` query parameter to `/api/questions` (default `global`).
2. Update `generateDaily.js` (and/or `questions.js` depending on wiring) to read from `story_audiences` when audience is provided.
3. Serve India users from `story_audiences('india')` with the 60/25/15 mix.
4. A/B: for one week, log the `audience` requested per session to confirm client is sending the right value for India traffic.

**Exit criteria:** India users report improved relevance (qualitative); global users see no regression.

---

## 10. Drawbacks & Concerns

### 10.1 Gazetteer Maintenance

**Problem:** `GEO_ALIASES` is hand-curated and will have gaps. A new city, a political party rename, a demonym change — all require code edits.

**Mitigation:**
- Start minimal (top 20 cities, major political entities) — extend as gaps surface.
- Log articles where `mentioned_geos` is empty but entities include Title-Cased proper nouns — periodic review surfaces missing aliases.
- A v2 upgrade path is to replace the gazetteer with Claude-based extraction at cluster time (one call per cluster, not per article) — not needed for MVP.

### 10.2 India Volume vs Global Volume

**Problem:** the current RSS registry has zero India-origin feeds. Even with perfect geo enrichment, the `source_country='in'` component of the audience score is always zero, and India relevance depends entirely on mentions in global publishers' coverage.

**Mitigation:**
- Phase 1 deliverable should include adding ~10 India-origin feeds (The Hindu, Hindustan Times, Economic Times, Indian Express, Mint, NDTV, Scroll, India Today, Moneycontrol, LiveMint).
- Flag the gap explicitly in the rollout plan — without Indian sources, the pipeline can only surface India-relevant global stories, not India-originating stories. That may be acceptable for MVP (global stories with India angle cover a lot) but it's a known ceiling.

### 10.3 Cluster Cross-Contamination

**Problem:** with geo-diverse sources but one global clusterer, a story about "Congress passes bill" could cluster the US Congress with India's Indian National Congress party on entity overlap.

**Mitigation:**
- The existing `high_signal_entity` gate in `nlp.js` already reduces this (requires ≥2 shared entities including ≥1 high-signal).
- Add a soft penalty: if a candidate cluster merge has `primary_geos` disjoint from the article's `mentioned_geos`, require a stricter match (≥3 shared entities instead of ≥2).
- This is a small change to `clusterer.js` matching logic — gated behind `FLAGS.geoClusterGuard` for safe rollout.

### 10.4 `reason` Field is Cosmetic

**Problem:** the `story_audiences.reason` column adds a string per row but is never queried in the hot path — only used for debug/audit.

**Mitigation:** acceptable cost (tiny payload, 7-day retention). If row count scales 10×, revisit and demote to a derived view.

### 10.5 Serving Mix is Heuristic

**Problem:** 60/25/15 is a guess. Real engagement data will likely show a different optimal.

**Mitigation:**
- Store the mix as `FLAGS.audienceFeedMix` — tunable without deploy.
- Phase 5 includes a week of observational A/B (same mix for all India users, log session length + completion rate) to establish a baseline.
- V2: learn mix per user cohort.

---

## 11. Out of Scope for MVP

| Feature | Rationale for deferral |
|---|---|
| `feed_registry` DB table | JS module is reviewable via PR; ~50 feeds is too few to need a table. |
| IP-based geo inference | Too noisy (VPNs, travel); client locale is clean. |
| Per-user personalization | Needs onboarding signal; audience-coarse is sufficient for first relevance gain. |
| UK, US, EU audiences | Add once India shows the pattern works; same schema, new rows. |
| LLM-based geo enrichment | Gazetteer + source metadata is cheap and deterministic; revisit if miss rate is high. |
| Automatic gazetteer learning | Review-based extension via PR is fine for MVP volume. |
| Geo-aware clustering | Keep one global clusterer; cross-contamination is addressed via entity-gate tightening. |
| Per-geo quality thresholds | `confidence_score >= 6` stays global; a geo might have a different distribution but that's v2. |
| Real-time feed toggling | `vercel dev` + redeploy is fine; no live toggling needed. |

---

## 12. Open Questions

| # | Question | Impact | Decision by |
|---|---|---|---|
| Q1 | Do we add Indian-origin feeds as part of Phase 1 or as a separate prerequisite? | India volume is structurally capped without them. | Before starting Phase 2. |
| Q2 | Should `story_audiences` also exist for categories where a story doesn't qualify for any audience bucket (score below `filler` threshold)? | Feed completeness vs table size. | Start by writing a row only if score ≥ tail threshold; revisit if feeds look thin. |
| Q3 | Is `audience_geo` a free-form text column or a FK into an `audiences` table? | Extensibility vs schema churn. | Free-form text + CHECK constraint on known values; migrate to FK when we exceed ~5 audiences. |
| Q4 | Does `global_significance_score` belong on `stories` or `story_audiences(audience_geo='global')`? | Semantic clarity. | Keep on `stories` — it's an intrinsic property, not a projection. The `global` row of `story_audiences` uses it as its `relevance_score`. |
| Q5 | How do we handle a story whose `primary_geos` flip between runs due to new articles? | Feed churn. | `story_audiences` rows are upserted on every synthesis — rely on the River model; no special handling. |
| Q6 | Should the `60/25/15` mix vary by category? (e.g. `science` is inherently global) | Feed feel per category. | Start uniform; tune per category only if engagement data demands it. |

---

## Summary

| Dimension | Before | After |
|---|---|---|
| Scrape queues | 1 global | 1 global (unchanged) |
| Clusterers | 1 global | 1 global (unchanged) |
| Synthesizers | 1 global | 1 global (unchanged) |
| `stories` rows per event | 1 | 1 (unchanged) |
| Ranking key | `story_score` only | `story_score` (quality) + `global_significance_score` (global) + `relevance_score` per audience |
| Feed selection | Global top-N | India: 60/25/15 mix from `story_audiences('india')`; Global: top-N by `global_significance_score` |
| New Azure resources | — | None |
| New DB tables | — | `story_audiences` (+ column additions on existing tables) |
| New dependencies | — | None (gazetteer in-repo, same no-NLP-library philosophy as `nlp.js`) |
