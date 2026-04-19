#!/usr/bin/env node
// Unit tests for lib/geo.js
//
// Usage: node --test test/geo.test.js
//
// Covers Phase 3 tracker items 3.9 and 3.10:
//   - extractMentionedGeos returns expected codes on a seeded set
//   - computeAudienceProjection never returns a rank_bucket/rank_priority
//     pair that diverges from { hero:1, standard:2, tail:3, filler:4 }

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUDIENCES,
  GEO_ALIASES,
  REGIONS,
  extractMentionedGeos,
  mentionStrength,
  computeArticleAudienceScore,
  computePrimaryGeos,
  computeClusterGeoScores,
  computeAudienceProjection,
} from "../lib/geo.js";

// ── extractMentionedGeos ─────────────────────────────────────────────────────

test("extractMentionedGeos: empty / non-string input", () => {
  assert.deepEqual(extractMentionedGeos(""), []);
  assert.deepEqual(extractMentionedGeos(null), []);
  assert.deepEqual(extractMentionedGeos(undefined), []);
  assert.deepEqual(extractMentionedGeos(42), []);
});

test("extractMentionedGeos: India demonym + city", () => {
  const codes = extractMentionedGeos("Indian markets opened in Mumbai today.");
  assert.ok(codes.includes("in"));
  assert.equal(codes.length, 1);
});

test("extractMentionedGeos: multi-word alias matched as whole", () => {
  // 'new delhi' must match before bare 'delhi' so the phrase is consumed
  // as one hit rather than counted twice.
  const codes = extractMentionedGeos("The prime minister landed in New Delhi.");
  assert.deepEqual(codes, ["in"]);
});

test("extractMentionedGeos: cross-country article", () => {
  const codes = extractMentionedGeos(
    "Pakistan and India held talks in Dhaka, with Nepal sending observers.",
  );
  assert.deepEqual(codes.sort(), ["bd", "in", "np", "pk"]);
});

test("extractMentionedGeos: case-insensitive word boundaries", () => {
  assert.deepEqual(extractMentionedGeos("INDIA vs Pakistan").sort(), ["in", "pk"]);
});

test("extractMentionedGeos: substring non-match", () => {
  // 'indianapolis' must not trigger 'indian' — requires word boundaries.
  assert.deepEqual(extractMentionedGeos("Indianapolis hosted the summit."), []);
});

test("extractMentionedGeos: no matches", () => {
  assert.deepEqual(
    extractMentionedGeos("The cafe near the stadium was full."),
    [],
  );
});

// ── mentionStrength ──────────────────────────────────────────────────────────

test("mentionStrength: caps at 1.0", () => {
  const text = "India India India India India India";
  assert.equal(mentionStrength(text, "in"), 1.0);
});

test("mentionStrength: scales linearly below cap", () => {
  assert.equal(mentionStrength("India", "in"), 0.25);
  assert.equal(mentionStrength("India and Mumbai", "in"), 0.5);
});

test("mentionStrength: unknown country returns 0", () => {
  assert.equal(mentionStrength("India", "zz"), 0);
});

// ── computeArticleAudienceScore ──────────────────────────────────────────────

test("computeArticleAudienceScore india: domestic source hits 4 of 4 terms", () => {
  const score = computeArticleAudienceScore(
    "in",
    ["in"],
    "india",
    "India climate summit talks continue in New Delhi.",
    { source_region: "south_asia", is_global_source: false, authority_score: 0.6 },
  );
  // 0.40 + 0.35*mentionStrength + 0.15 + 0.10 (climate summit keyword + 'in' mentioned)
  assert.ok(score > 0.6, `expected > 0.6, got ${score}`);
});

test("computeArticleAudienceScore global: wire-service multi-geo", () => {
  const score = computeArticleAudienceScore(
    "gb",
    ["in", "pk", "bd"],
    "global",
    "The G20 summit in Delhi brought leaders from India, Pakistan and Bangladesh.",
    { is_global_source: true, authority_score: 0.8 },
  );
  // 0.30 is_global + 0.30 geopolitical + 0.25 multi-geo + 0.15 * 0.8
  assert.ok(score > 0.9, `expected > 0.9, got ${score}`);
});

// ── computePrimaryGeos ───────────────────────────────────────────────────────

test("computePrimaryGeos: mention ratio trigger (>= 50%)", () => {
  const members = [
    { mentioned_geos: ["in"], source_country: "us" },
    { mentioned_geos: ["in", "pk"], source_country: "gb" },
    { mentioned_geos: [], source_country: "fr" },
    { mentioned_geos: [], source_country: "de" },
  ];
  // in: 2/4 = 50% → primary. pk: 1/4 → not primary.
  const primary = computePrimaryGeos(members);
  assert.ok(primary.includes("in"));
  assert.ok(!primary.includes("pk"));
});

test("computePrimaryGeos: source count trigger (>= 2)", () => {
  const members = [
    { mentioned_geos: [], source_country: "in" },
    { mentioned_geos: [], source_country: "in" },
    { mentioned_geos: [], source_country: "us" },
  ];
  // Two Indian sources → 'in' is primary via source evidence alone.
  assert.ok(computePrimaryGeos(members).includes("in"));
});

test("computePrimaryGeos: empty input", () => {
  assert.deepEqual(computePrimaryGeos([]), []);
  assert.deepEqual(computePrimaryGeos(null), []);
});

// ── computeClusterGeoScores ──────────────────────────────────────────────────

test("computeClusterGeoScores: mean per audience", () => {
  const members = [
    { geo_scores: { india: 0.8, global: 0.4 } },
    { geo_scores: { india: 0.4, global: 0.8 } },
  ];
  const out = computeClusterGeoScores(members);
  assert.ok(Math.abs(out.india - 0.6) < 1e-9);
  assert.ok(Math.abs(out.global - 0.6) < 1e-9);
});

test("computeClusterGeoScores: dense keys for every AUDIENCES entry", () => {
  const out = computeClusterGeoScores([]);
  for (const a of AUDIENCES) {
    assert.ok(a in out, `missing audience key ${a}`);
    assert.equal(out[a], 0);
  }
});

test("computeClusterGeoScores: ignores missing/invalid entries", () => {
  const members = [
    { geo_scores: { india: 0.5 } },
    {},
    { geo_scores: { india: "bad" } },
    { geo_scores: { india: 0.9 } },
  ];
  const out = computeClusterGeoScores(members);
  assert.ok(Math.abs(out.india - 0.7) < 1e-9);
});

// ── computeAudienceProjection: bucket/priority invariant (tracker 3.10) ──────

test("computeAudienceProjection: bucket→priority mapping never diverges", () => {
  const expected = { hero: 1, standard: 2, tail: 3, filler: 4 };

  const fixtures = [];
  // India: sweep scores across thresholds with both primary-geo in and out.
  for (const score of [0, 2, 4, 6, 7, 8, 11, 12, 13, 20]) {
    for (const inPrimary of [true, false]) {
      fixtures.push({
        audience: "india",
        cluster: {
          primary_geos: inPrimary ? ["in"] : [],
          source_countries: inPrimary ? ["in"] : [],
          primary_entities: ["india"],
          geo_scores: { india: Math.min(1, score / 15), global: 0 },
        },
        story: { global_significance_score: 5 },
        extras: { indian_article_fraction: 0.5 },
        hintScore: score,
      });
    }
  }
  // Global: sweep global_significance_score across thresholds.
  for (const g of [0, 5, 6, 9, 10, 13, 14, 20]) {
    fixtures.push({
      audience: "global",
      cluster: {
        primary_geos: [],
        source_countries: ["us", "gb", "fr"],
        primary_entities: [],
        unique_domains: ["a", "b", "c"],
        geo_scores: { india: 0, global: 0.5 },
      },
      story: { global_significance_score: g },
      extras: { max_authority_score: 0.8 },
      hintScore: g,
    });
  }

  for (const f of fixtures) {
    const out = computeAudienceProjection(f.story, f.cluster, f.audience, f.extras);
    assert.ok(
      Object.prototype.hasOwnProperty.call(expected, out.rank_bucket),
      `unexpected rank_bucket=${out.rank_bucket}`,
    );
    assert.equal(
      out.rank_priority,
      expected[out.rank_bucket],
      `priority/bucket mismatch: bucket=${out.rank_bucket} priority=${out.rank_priority}`,
    );
  }
});

test("computeAudienceProjection: India hero requires score≥12 AND 'in' in primary_geos", () => {
  const story = { global_significance_score: 5 };
  const cluster = {
    primary_geos: ["in"],
    source_countries: ["in", "us"],
    primary_entities: ["india", "modi"],
    geo_scores: { india: 1.0 },
  };
  const extras = { indian_article_fraction: 1.0 };
  const india = computeAudienceProjection(story, cluster, "india", extras);
  assert.equal(india.rank_bucket, "hero");
  assert.equal(india.rank_priority, 1);

  // Same score, 'in' not primary → cannot be hero.
  const cluster2 = { ...cluster, primary_geos: [] };
  const notHero = computeAudienceProjection(story, cluster2, "india", extras);
  assert.notEqual(notHero.rank_bucket, "hero");
});

test("computeAudienceProjection: Global bucket tracks global_significance_score", () => {
  const base = {
    cluster: { primary_geos: [], source_countries: [], primary_entities: [] },
  };
  assert.equal(
    computeAudienceProjection({ global_significance_score: 14 }, base.cluster, "global").rank_bucket,
    "hero",
  );
  assert.equal(
    computeAudienceProjection({ global_significance_score: 10 }, base.cluster, "global").rank_bucket,
    "standard",
  );
  assert.equal(
    computeAudienceProjection({ global_significance_score: 6 }, base.cluster, "global").rank_bucket,
    "tail",
  );
  assert.equal(
    computeAudienceProjection({ global_significance_score: 0 }, base.cluster, "global").rank_bucket,
    "filler",
  );
});

// ── Data integrity ───────────────────────────────────────────────────────────

test("REGIONS.south_asia matches GEO_ALIASES entries", () => {
  for (const code of REGIONS.south_asia) {
    assert.ok(GEO_ALIASES[code], `REGIONS.south_asia references missing code: ${code}`);
    assert.equal(GEO_ALIASES[code].region, "south_asia");
  }
});
