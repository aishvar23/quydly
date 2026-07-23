#!/usr/bin/env node
// Unit tests for the social candidate selection pure logic + sensitivity classifier.
//
// Usage: node --test test/social-candidates.test.js
//
// Covers Phase 1 tracker items:
//   1.1 buildEligiblePairs (dedupe, per-geo cap, ordering), buildPublishReason
//   1.2 classifySensitivity → LOW/MEDIUM/HIGH/UNKNOWN
//   1.6 per-geo selection respects the daily cap

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildEligiblePairs, buildPublishReason, groupForCategory } from "../lib/social/social-candidates.js";
import { classifySensitivity, SENSITIVITY } from "../lib/social/social-safety.js";

// ── classifySensitivity ──────────────────────────────────────────────────────

test("classifySensitivity: HIGH on violent/criminal signal regardless of category", () => {
  assert.equal(
    classifySensitivity({ category_id: "science", headline: "Three killed in factory blast", summary: "" }),
    SENSITIVITY.HIGH
  );
  assert.equal(
    classifySensitivity({ category_id: "world", headline: "War escalates at border", summary: "" }),
    SENSITIVITY.HIGH
  );
  assert.equal(
    classifySensitivity({ category_id: "world", headline: "CEO arrested on fraud charges", summary: "" }),
    SENSITIVITY.HIGH
  );
});

test("classifySensitivity: MEDIUM on advice/persuasion topics", () => {
  assert.equal(
    classifySensitivity({ category_id: "world", headline: "National election heats up", summary: "Candidates spar" }),
    SENSITIVITY.MEDIUM
  );
  assert.equal(
    classifySensitivity({ category_id: "finance", headline: "New vaccine shows promise", summary: "clinical trial" }),
    SENSITIVITY.MEDIUM
  );
});

test("classifySensitivity: LOW on safe category with no sensitive signal", () => {
  assert.equal(
    classifySensitivity({ category_id: "technology", headline: "New chip doubles battery life", summary: "Engineers unveil design" }),
    SENSITIVITY.LOW
  );
  assert.equal(
    classifySensitivity({ category_id: "science", headline: "Telescope spots distant galaxy", summary: "" }),
    SENSITIVITY.LOW
  );
});

test("classifySensitivity: UNKNOWN on unmapped category with no signal, and empty input", () => {
  assert.equal(
    classifySensitivity({ category_id: "world", headline: "Trade summit concludes", summary: "Leaders agree on terms" }),
    SENSITIVITY.UNKNOWN
  );
  assert.equal(classifySensitivity({}), SENSITIVITY.UNKNOWN);
  assert.equal(classifySensitivity(null), SENSITIVITY.UNKNOWN);
});

test("classifySensitivity: word-boundary avoids false positives", () => {
  // "warm" / "warranty" must not trip the "war" rule.
  assert.equal(
    classifySensitivity({ category_id: "technology", headline: "Startup offers warranty on warm-weather gear", summary: "" }),
    SENSITIVITY.LOW
  );
});

// ── buildEligiblePairs ───────────────────────────────────────────────────────

function story(id, score) {
  return { id, story_score: score, confidence_score: 8, category_id: "tech", headline: "h", summary: "s" };
}

test("buildEligiblePairs: excludes existing candidates and missing stories", () => {
  const storyById = new Map([[1, story(1, 50)], [2, story(2, 40)]]);
  const audiences = [
    { story_id: 1, audience_geo: "global", relevance_score: 30 },
    { story_id: 2, audience_geo: "global", relevance_score: 25 }, // already a candidate
    { story_id: 9, audience_geo: "global", relevance_score: 99 }, // no story row
  ];
  const out = buildEligiblePairs({
    audiences,
    storyById,
    existingKeys: new Set(["2::global"]),
    countsByGeo: {},
    cap: 10,
  });
  assert.deepEqual(out.map((p) => p.story.id), [1]);
});

test("buildEligiblePairs: enforces per-geo daily cap accounting for today's count", () => {
  const storyById = new Map([[1, story(1, 50)], [2, story(2, 40)], [3, story(3, 30)]]);
  const audiences = [
    { story_id: 1, audience_geo: "india", relevance_score: 30 },
    { story_id: 2, audience_geo: "india", relevance_score: 28 },
    { story_id: 3, audience_geo: "india", relevance_score: 26 },
  ];
  // cap 2, already 1 created today → only 1 new slot remains.
  const out = buildEligiblePairs({
    audiences,
    storyById,
    existingKeys: new Set(),
    countsByGeo: { india: 1 },
    cap: 2,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].story.id, 1); // highest relevance first
});

test("buildEligiblePairs: perRunCap drips a subset per run while staying under the daily cap", () => {
  const storyById = new Map([[1, story(1, 50)], [2, story(2, 40)], [3, story(3, 30)]]);
  const audiences = [
    { story_id: 1, audience_geo: "global", relevance_score: 30 },
    { story_id: 2, audience_geo: "global", relevance_score: 28 },
    { story_id: 3, audience_geo: "global", relevance_score: 26 },
  ];
  // Daily cap 24, but only 1 may be created this run → highest relevance wins.
  const out = buildEligiblePairs({
    audiences,
    storyById,
    existingKeys: new Set(),
    countsByGeo: {},
    cap: 24,
    perRunCap: 1,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].story.id, 1);
});

test("buildEligiblePairs: perRunCap is bounded by the remaining daily cap", () => {
  const storyById = new Map([[1, story(1, 50)], [2, story(2, 40)]]);
  const audiences = [
    { story_id: 1, audience_geo: "global", relevance_score: 30 },
    { story_id: 2, audience_geo: "global", relevance_score: 28 },
  ];
  // perRunCap 5 would allow both, but only 1 daily slot remains (cap 24, 23 used).
  const out = buildEligiblePairs({
    audiences,
    storyById,
    existingKeys: new Set(),
    countsByGeo: { global: 23 },
    cap: 24,
    perRunCap: 5,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].story.id, 1);
});

test("buildEligiblePairs: orders by geo, then relevance desc, then story_score desc", () => {
  const storyById = new Map([[1, story(1, 10)], [2, story(2, 90)], [3, story(3, 50)]]);
  const audiences = [
    { story_id: 1, audience_geo: "global", relevance_score: 40 },
    { story_id: 2, audience_geo: "global", relevance_score: 40 }, // tie on rel → higher score wins
    { story_id: 3, audience_geo: "india", relevance_score: 99 },
  ];
  const out = buildEligiblePairs({
    audiences, storyById, existingKeys: new Set(), countsByGeo: {}, cap: 10,
  });
  assert.deepEqual(
    out.map((p) => `${p.audienceGeo}:${p.story.id}`),
    ["global:2", "global:1", "india:3"]
  );
});

// ── category weighting (FLAGS.social.categoryWeights) ────────────────────────

const WEIGHTS = {
  enabled: true,
  defaultGroup: "others",
  groups: {
    aiTech: { categories: ["ai", "tech"], weight: 40 },
    world:  { categories: ["world"],      weight: 40 },
    sports: { categories: ["sports"],     weight: 10 },
    others: { categories: [],             weight: 10 },
  },
};

function catStory(id, category, score = 50) {
  return { id, story_score: score, confidence_score: 8, category_id: category, headline: "h", summary: "s" };
}

// Ample supply in every group; rel score descending by id so ordering is known.
function supply(countsByCategory) {
  const storyById = new Map();
  const audiences = [];
  let id = 1;
  for (const [category, n] of Object.entries(countsByCategory)) {
    for (let i = 0; i < n; i++, id++) {
      storyById.set(id, catStory(id, category, 100 - id));
      audiences.push({ story_id: id, audience_geo: "global", relevance_score: 100 - id });
    }
  }
  return { storyById, audiences };
}

function mixOf(pairs) {
  const mix = {};
  for (const p of pairs) {
    const g = groupForCategory(p.story.category_id, WEIGHTS);
    mix[g] = (mix[g] || 0) + 1;
  }
  return mix;
}

test("groupForCategory: maps listed categories to their group, everything else to defaultGroup", () => {
  assert.equal(groupForCategory("ai", WEIGHTS), "aiTech");
  assert.equal(groupForCategory("tech", WEIGHTS), "aiTech");
  assert.equal(groupForCategory("world", WEIGHTS), "world");
  assert.equal(groupForCategory("sports", WEIGHTS), "sports");
  assert.equal(groupForCategory("culture", WEIGHTS), "others");
  assert.equal(groupForCategory("finance", WEIGHTS), "others");
  assert.equal(groupForCategory(null, WEIGHTS), "others");
});

test("categoryWeights: 10 slots with full supply land 4/4/1/1 (40/40/10/10)", () => {
  const { storyById, audiences } = supply({ ai: 3, tech: 3, world: 6, sports: 3, culture: 3 });
  const out = buildEligiblePairs({
    audiences, storyById, existingKeys: new Set(), countsByGeo: {},
    cap: 10, categoryWeights: WEIGHTS,
  });
  assert.equal(out.length, 10);
  assert.deepEqual(mixOf(out), { aiTech: 4, world: 4, sports: 1, others: 1 });
});

test("categoryWeights: empty group's share redistributes proportionally (never posts nothing)", () => {
  // No sports and no ai/tech supply at all → world and others split all 10 slots.
  const { storyById, audiences } = supply({ world: 20, culture: 20 });
  const out = buildEligiblePairs({
    audiences, storyById, existingKeys: new Set(), countsByGeo: {},
    cap: 10, categoryWeights: WEIGHTS,
  });
  assert.equal(out.length, 10);
  assert.deepEqual(mixOf(out), { world: 8, others: 2 }); // 40:10 ratio over 10 slots
});

test("categoryWeights: only 'others' available → all slots still fill", () => {
  const { storyById, audiences } = supply({ culture: 5 });
  const out = buildEligiblePairs({
    audiences, storyById, existingKeys: new Set(), countsByGeo: {},
    cap: 3, categoryWeights: WEIGHTS,
  });
  assert.equal(out.length, 3);
  assert.deepEqual(mixOf(out), { others: 3 });
});

test("categoryWeights: groupCountsByGeo seeds the round-robin so 1-per-run drip converges", () => {
  // Today the geo already created 4 world + 1 others and zero aiTech; with a
  // single run slot the most-behind group (aiTech) must win — not world, even
  // though world stories outscore everything.
  const { storyById, audiences } = supply({ world: 5, ai: 1, culture: 3 });
  const out = buildEligiblePairs({
    audiences, storyById, existingKeys: new Set(),
    countsByGeo: { global: 5 }, cap: 24, perRunCap: 1,
    categoryWeights: WEIGHTS,
    groupCountsByGeo: { global: { world: 4, others: 1 } },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].story.category_id, "ai");
});

test("categoryWeights: within a group, higher relevance still wins", () => {
  const storyById = new Map([[1, catStory(1, "ai", 50)], [2, catStory(2, "tech", 50)]]);
  const audiences = [
    { story_id: 1, audience_geo: "global", relevance_score: 25 },
    { story_id: 2, audience_geo: "global", relevance_score: 30 },
  ];
  const out = buildEligiblePairs({
    audiences, storyById, existingKeys: new Set(), countsByGeo: {},
    cap: 1, categoryWeights: WEIGHTS,
  });
  assert.equal(out[0].story.id, 2);
});

test("categoryWeights: disabled → legacy pure score ordering", () => {
  const { storyById, audiences } = supply({ culture: 2, ai: 2 });
  const out = buildEligiblePairs({
    audiences, storyById, existingKeys: new Set(), countsByGeo: {},
    cap: 4, categoryWeights: { ...WEIGHTS, enabled: false },
  });
  // Pure relevance order = ascending id in supply()
  assert.deepEqual(out.map((p) => p.story.id), [1, 2, 3, 4]);
});

// ── buildPublishReason ───────────────────────────────────────────────────────

test("buildPublishReason: includes score, confidence, relevance, sensitivity", () => {
  const reason = buildPublishReason(story(1, 55), 33, SENSITIVITY.LOW);
  assert.match(reason, /score=55/);
  assert.match(reason, /conf=8/);
  assert.match(reason, /rel=33/);
  assert.match(reason, /sensitivity=LOW/);
});
