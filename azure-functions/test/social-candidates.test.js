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

import { buildEligiblePairs, buildPublishReason } from "../lib/social/social-candidates.js";
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

// ── buildPublishReason ───────────────────────────────────────────────────────

test("buildPublishReason: includes score, confidence, relevance, sensitivity", () => {
  const reason = buildPublishReason(story(1, 55), 33, SENSITIVITY.LOW);
  assert.match(reason, /score=55/);
  assert.match(reason, /conf=8/);
  assert.match(reason, /rel=33/);
  assert.match(reason, /sensitivity=LOW/);
});
