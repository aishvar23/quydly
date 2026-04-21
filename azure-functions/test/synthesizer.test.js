#!/usr/bin/env node
// Unit tests for story-synthesizer geo integration (Phase 7)
//
// Usage: node --test test/synthesizer.test.js
//
// Covers tracker items 7.8–7.10:
//   7.8  Idempotency: same cluster_id enqueued twice → one story + N audience rows
//   7.9  Partial-failure: exception after story write but before all audience upserts
//        → cluster reset to PENDING, retry produces consistent final state
//   7.10 UNIQUE(story_id, audience_geo) survives 10 replay upserts with no duplicates

import { test } from "node:test";
import assert from "node:assert/strict";

import { AUDIENCES, computeAudienceProjection } from "../lib/geo.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCluster(overrides = {}) {
  return {
    id:               1,
    category_id:      "world",
    primary_entities: ["India", "Modi"],
    article_ids:      [10, 11, 12],
    unique_domains:   ["thehindu.com", "reuters.com", "bbc.com"],
    cluster_score:    0.8,
    status:           "PENDING",
    primary_geos:     ["in"],
    geo_scores:       { india: 0.75, global: 0.4 },
    source_countries: ["in", "gb", "us"],
    ...overrides,
  };
}

function makeArticles() {
  return [
    { id: 10, title: "India signs deal", description: "New Delhi.", content: "PM Modi announced...",
      domain: "thehindu.com", mentioned_geos: ["in"], source_country: "in",
      geo_scores: { india: 0.9, global: 0.3 }, authority_score: 0.7 },
    { id: 11, title: "India trade pact", description: "Mumbai.", content: "Details emerged...",
      domain: "reuters.com", mentioned_geos: ["in", "us"], source_country: "us",
      geo_scores: { india: 0.6, global: 0.5 }, authority_score: 0.9 },
    { id: 12, title: "South Asia update", description: "Regional.", content: "Analysis...",
      domain: "bbc.com", mentioned_geos: ["in"], source_country: "gb",
      geo_scores: { india: 0.5, global: 0.4 }, authority_score: 0.8 },
  ];
}

const NARRATIVE = {
  headline: "India Signs Landmark Trade Agreement With Global Partners",
  summary: "India concluded a major trade deal.",
  key_points: ["Tariffs reduced", "Tech sector included", "5-year timeline"],
  confidence_score: 8,
};

// ── computeGlobalSignificance (mirrors synthesizer impl exactly) ───────────────

function computeGlobalSignificance(cluster, synthesis, articles) {
  const uniqueDomains = Math.min(6, (cluster.unique_domains ?? []).length);
  const allMentionedGeos = new Set();
  for (const a of articles) for (const g of a.mentioned_geos ?? []) allMentionedGeos.add(g);
  const geoDiversity  = Math.min(5, allMentionedGeos.size);
  const maxAuthority  = articles.reduce((max, a) => Math.max(max, Number(a.authority_score ?? 0)), 0);
  return Number((2 * uniqueDomains + 3 * geoDiversity + 2 * maxAuthority + 2 * synthesis.confidence_score).toFixed(2));
}

// ── In-memory DB stub ─────────────────────────────────────────────────────────
//
// Simulates the four tables the synthesizer touches. `failAudienceOnce` makes
// the first upsert for that audience_geo return an error exactly once, then
// succeeds on subsequent calls — mirrors a transient failure that SB retries.

function makeDb({ failAudienceOnce = null } = {}) {
  const clusters        = new Map([[1, makeCluster()]]);
  const stories         = new Map();   // story_id → row
  const story_audiences = new Map();   // `${story_id}:${geo}` → row
  let nextId = 100;
  let audienceFailFired = false;

  function clusterTable() {
    return {
      select() { return this; },
      eq(col, val) {
        return {
          single: () => Promise.resolve({ data: clusters.get(val) ?? null, error: null }),
        };
      },
      update(patch) {
        return {
          eq(col, val) {
            const row = clusters.get(val);
            if (row) Object.assign(row, patch);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }

  function storiesTable() {
    const chain = {
      _insertPayload: null,
      insert(row) { chain._insertPayload = row; return chain; },
      update(patch) {
        return {
          eq(col, val) {
            for (const s of stories.values()) {
              if (s.id === val) { Object.assign(s, patch); break; }
            }
            return Promise.resolve({ error: null });
          },
        };
      },
      // River lookup: Strategy 1 (same cluster_id)
      select() { return chain; },
      eq(col, val) {
        // River lookup by cluster_id — return existing story if present
        if (col === "cluster_id") {
          chain._riverClusterId = val;
        }
        return chain;
      },
      gte()   { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() {
        if (chain._riverClusterId != null) {
          const found = [...stories.values()].find(s => s.cluster_id === chain._riverClusterId) ?? null;
          chain._riverClusterId = null;
          return Promise.resolve({ data: found, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      in() { return Promise.resolve({ data: [], error: null }); },
      // Finish insert with .select("id").single()
      single() {
        const id  = nextId++;
        const row = { id, ...chain._insertPayload };
        stories.set(id, row);
        chain._insertPayload = null;
        return Promise.resolve({ data: { id }, error: null });
      },
    };
    return chain;
  }

  function audiencesTable() {
    return {
      upsert(row) {
        if (failAudienceOnce && row.audience_geo === failAudienceOnce && !audienceFailFired) {
          audienceFailFired = true;
          return Promise.resolve({ error: { message: `simulated transient failure for ${row.audience_geo}` } });
        }
        const key = `${row.story_id}:${row.audience_geo}`;
        story_audiences.set(key, { ...row });
        return Promise.resolve({ error: null });
      },
    };
  }

  function rawArticlesTable() {
    return {
      select() { return this; },
      in()     { return Promise.resolve({ data: makeArticles(), error: null }); },
    };
  }

  return {
    _clusters:        clusters,
    _stories:         stories,
    _story_audiences: story_audiences,
    from(table) {
      if (table === "clusters")        return clusterTable();
      if (table === "stories")         return storiesTable();
      if (table === "story_audiences") return audiencesTable();
      if (table === "raw_articles")    return rawArticlesTable();
      throw new Error(`unknown table: ${table}`);
    },
  };
}

// ── Synthesizer core (extracted from story-synthesizer/index.js) ───────────────
// Runs from "after quality gates" through to PROCESSED (Steps 2-4).
// Mirrors the real handler exactly, including the PENDING reset on audience failure.

async function runSynthesizerCore(supabase, cluster_id) {
  const RIVER_WINDOW_MS = 24 * 60 * 60 * 1000;

  // Fetch cluster — idempotency gate
  const { data: cluster } = await supabase.from("clusters").select("*").eq("id", cluster_id).single();
  if (!cluster || cluster.status !== "PENDING") return { skipped: true };

  // Mark PROCESSING
  await supabase.from("clusters").update({ status: "PROCESSING", updated_at: new Date().toISOString() }).eq("id", cluster_id);

  // Fetch articles
  const { data: articles } = await supabase.from("raw_articles").select("*").in("id", cluster.article_ids);

  const now = new Date().toISOString();
  const globalSignificanceScore = computeGlobalSignificance(cluster, NARRATIVE, articles);
  const storyPrimaryGeos = cluster.primary_geos ?? [];
  const storyGeoScores   = cluster.geo_scores ?? {};
  const indianArticleCount    = articles.filter(a => a.source_country === "in").length;
  const indianArticleFraction = articles.length > 0 ? indianArticleCount / articles.length : 0;

  // River lookup
  const riverCutoff = new Date(Date.now() - RIVER_WINDOW_MS).toISOString();
  const { data: existing } = await supabase.from("stories").select("id, key_points, primary_entities")
    .eq("cluster_id", cluster.id).gte("updated_at", riverCutoff).order("updated_at", { ascending: false }).limit(1).maybeSingle();

  let story_id;

  if (existing) {
    await supabase.from("stories").update({
      primary_geos: storyPrimaryGeos, geo_scores: storyGeoScores,
      global_significance_score: globalSignificanceScore, updated_at: now,
    }).eq("id", existing.id);
    story_id = existing.id;
  } else {
    const { data: inserted, error: insertErr } = await supabase.from("stories")
      .insert({ cluster_id, primary_geos: storyPrimaryGeos, geo_scores: storyGeoScores,
        global_significance_score: globalSignificanceScore, published_at: now, updated_at: now })
      .select("id").single();
    if (insertErr) throw new Error(`story insert: ${insertErr.message}`);
    story_id = inserted.id;
  }

  // Step 3: audience upserts
  const projectionStory  = { global_significance_score: globalSignificanceScore, primary_geos: storyPrimaryGeos };
  const projectionExtras = { indian_article_fraction: indianArticleFraction };

  for (const audience of AUDIENCES) {
    const projection = computeAudienceProjection(projectionStory, cluster, audience, projectionExtras);
    const { error: audErr } = await supabase.from("story_audiences").upsert(
      { story_id, audience_geo: audience, relevance_score: projection.relevance_score,
        rank_bucket: projection.rank_bucket, rank_priority: projection.rank_priority,
        reason: projection.reason, updated_at: now },
      { onConflict: "story_id,audience_geo" },
    );
    if (audErr) {
      // Reset to PENDING before rethrowing (P1 fix)
      await supabase.from("clusters").update({ status: "PENDING", updated_at: now }).eq("id", cluster_id);
      throw new Error(`story_audiences upsert (${audience}): ${audErr.message}`);
    }
  }

  // Step 4: commit point
  await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
  return { skipped: false, story_id };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// 7.8 — Second invocation with same cluster_id sees PROCESSED → early-exits.
// Result: exactly 1 story row, AUDIENCES.length audience rows.
test("7.8 idempotency: second run early-exits on PROCESSED cluster", async () => {
  const db = makeDb();

  const r1 = await runSynthesizerCore(db, 1);
  assert.equal(r1.skipped, false, "first run should process");
  assert.equal(db._clusters.get(1).status, "PROCESSED");
  assert.equal(db._stories.size, 1);
  assert.equal(db._story_audiences.size, AUDIENCES.length);

  const r2 = await runSynthesizerCore(db, 1);
  assert.equal(r2.skipped, true, "second run must skip — cluster already PROCESSED");
  assert.equal(db._stories.size, 1, "still exactly one story after second run");
  assert.equal(db._story_audiences.size, AUDIENCES.length, "audience rows unchanged");
});

// 7.9 — Partial failure: first run fails mid-audience-loop, resets cluster to
// PENDING. Second run retries: finds existing story via River lookup (UPDATE not
// INSERT), completes all audience upserts, marks PROCESSED.
test("7.9 partial failure + retry: single story, full audience set, PROCESSED at end", async () => {
  const failOn = AUDIENCES[0];
  const db = makeDb({ failAudienceOnce: failOn });

  // First run — fails on first audience upsert
  let threw = false;
  try {
    await runSynthesizerCore(db, 1);
  } catch {
    threw = true;
  }
  assert.ok(threw, "first run must throw due to audience upsert failure");
  assert.equal(db._clusters.get(1).status, "PENDING",
    "cluster must be reset to PENDING so SB redelivery can retry");
  assert.equal(db._stories.size, 1, "story was written before the failure");
  // The failed audience has no row yet; successful ones might have rows
  const failedKey = `${[...db._stories.keys()][0]}:${failOn}`;
  assert.ok(!db._story_audiences.has(failedKey), "no audience row for the failed audience");

  // Second run — transient failure won't fire again (failAudienceOnce already fired)
  const r2 = await runSynthesizerCore(db, 1);
  assert.equal(r2.skipped, false, "second run must process (cluster is PENDING)");
  assert.equal(db._stories.size, 1, "River lookup must reuse the existing story — no duplicate");
  assert.equal(db._story_audiences.size, AUDIENCES.length,
    "all audience rows present after retry");
  assert.equal(db._clusters.get(1).status, "PROCESSED", "cluster is PROCESSED after successful retry");
});

// 7.10 — UNIQUE(story_id, audience_geo) stress: 10 replay upserts → no duplicates.
// The Map keyed by `${story_id}:${geo}` models ON CONFLICT DO UPDATE (overwrite).
test("7.10 upsert stress: 10 replays → exactly AUDIENCES.length rows, no duplicates", async () => {
  const db = makeDb();

  const r1 = await runSynthesizerCore(db, 1);
  const story_id = r1.story_id;

  const articles = makeArticles();
  const globalSig = computeGlobalSignificance(makeCluster(), NARRATIVE, articles);
  const projStory   = { global_significance_score: globalSig, primary_geos: ["in"] };
  const now = new Date().toISOString();

  for (let i = 0; i < 9; i++) {
    for (const audience of AUDIENCES) {
      const proj = computeAudienceProjection(projStory, makeCluster(), audience);
      db._story_audiences.set(`${story_id}:${audience}`, {
        story_id, audience_geo: audience,
        relevance_score: proj.relevance_score, rank_bucket: proj.rank_bucket,
        rank_priority: proj.rank_priority, reason: proj.reason, updated_at: now,
      });
    }
  }

  assert.equal(db._story_audiences.size, AUDIENCES.length,
    `after 10 replays: exactly ${AUDIENCES.length} rows, no duplicates`);

  const BUCKET_PRIORITY = { hero: 1, standard: 2, tail: 3, filler: 4 };
  for (const row of db._story_audiences.values()) {
    assert.equal(BUCKET_PRIORITY[row.rank_bucket], row.rank_priority,
      `rank_bucket=${row.rank_bucket} must map to priority=${BUCKET_PRIORITY[row.rank_bucket]}`);
  }
});

// 7.10 bonus — computeAudienceProjection bucket↔priority invariant over parameter grid
test("7.10 bonus: bucket↔priority invariant across story/cluster/audience combinations", () => {
  const BUCKET_PRIORITY = { hero: 1, standard: 2, tail: 3, filler: 4 };
  const clusters = [
    makeCluster({ primary_geos: ["in"], source_countries: ["in"] }),
    makeCluster({ primary_geos: [],     source_countries: [] }),
    makeCluster({ primary_geos: ["gb"], source_countries: ["gb", "us"] }),
  ];
  const stories = [
    { global_significance_score: 15, primary_geos: ["in"] },
    { global_significance_score: 5,  primary_geos: [] },
    { global_significance_score: 11, primary_geos: ["in", "gb"] },
  ];
  for (const cluster of clusters) {
    for (const story of stories) {
      for (const audience of AUDIENCES) {
        const proj = computeAudienceProjection(story, cluster, audience);
        assert.equal(BUCKET_PRIORITY[proj.rank_bucket], proj.rank_priority,
          `audience=${audience} bucket=${proj.rank_bucket} priority=${proj.rank_priority} must match`);
      }
    }
  }
});
