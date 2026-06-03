#!/usr/bin/env node
// Unit tests for Instagram hashtag derivation (reach: §8.3).
//
// Usage: node --test test/social-hashtags.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { hashtagsFor, appendHashtags, entityTag } from "../lib/social/platforms/_hashtags.js";
import * as instagram from "../lib/social/platforms/instagram.js";
import { validatePost } from "../lib/social/social-validation.js";

const TECH_STORY = {
  id: 1,
  category_id: "tech",
  headline: "Nvidia unveils new AI chip as Jensen Huang touts demand",
  summary: "The company announced its next-generation accelerator at a developer event.",
  key_points: ["New chip targets data centers", "Shipping next year"],
  source_count: 3,
  primary_entities_enriched: [
    { name: "Nvidia", type: "org", role: "chipmaker" },
    { name: "Jensen Huang", type: "person", role: "CEO" },
  ],
  primary_entities: ["Nvidia", "Jensen Huang"],
};

// ── entityTag ─────────────────────────────────────────────────────────────────

test("entityTag: PascalCases names and drops punctuation", () => {
  assert.equal(entityTag("Sam Bankman-Fried"), "#SamBankmanFried");
  assert.equal(entityTag("FTX"), "#FTX");
  assert.equal(entityTag("Jensen Huang"), "#JensenHuang");
});

test("entityTag: strips digits and rejects too-short/too-long names", () => {
  assert.equal(entityTag("Boeing 737"), "#Boeing"); // digits stripped, trailing space collapses
  assert.equal(entityTag("3M"), null);              // → "M", 1 char → too short
  assert.equal(entityTag("X"), null);
  assert.equal(entityTag("A".repeat(40)), null);
});

// ── hashtagsFor ───────────────────────────────────────────────────────────────

test("hashtagsFor: category + entity + brand, in that order", () => {
  const tags = hashtagsFor(TECH_STORY);
  assert.deepEqual(tags, [
    "#Tech", "#Technology",          // category
    "#Nvidia", "#JensenHuang",       // entities
    "#Quydly", "#NewsQuiz", "#DailyNews", // brand
  ]);
});

test("hashtagsFor: caps entities via maxEntities", () => {
  const story = {
    category_id: "world",
    primary_entities_enriched: [
      { name: "Alice Adams", type: "person" },
      { name: "Bob Baker", type: "person" },
      { name: "Carol Clark", type: "person" },
      { name: "Dan Drake", type: "person" },
    ],
    primary_entities: [],
  };
  const tags = hashtagsFor(story, { maxEntities: 2 });
  assert.deepEqual(tags, ["#WorldNews", "#AliceAdams", "#BobBaker", "#Quydly", "#NewsQuiz", "#DailyNews"]);
});

test("hashtagsFor: respects total max (trims brand tags last)", () => {
  const tags = hashtagsFor(TECH_STORY, { max: 4 });
  assert.deepEqual(tags, ["#Tech", "#Technology", "#Nvidia", "#JensenHuang"]);
});

test("hashtagsFor: dedups case-insensitively across groups", () => {
  // An entity literally named "Tech" must not duplicate the category #Tech.
  const story = {
    category_id: "tech",
    primary_entities_enriched: [{ name: "Tech", type: "org" }],
    primary_entities: [],
  };
  const tags = hashtagsFor(story);
  assert.equal(tags.filter((t) => t.toLowerCase() === "#tech").length, 1);
});

test("hashtagsFor: brand tags always present even with no category/entities", () => {
  const tags = hashtagsFor({ category_id: "unknown", primary_entities: [], primary_entities_enriched: [] });
  assert.deepEqual(tags, ["#Quydly", "#NewsQuiz", "#DailyNews"]);
});

test("hashtagsFor: ignores entity types other than person/org/place", () => {
  const story = {
    category_id: "science",
    primary_entities_enriched: [
      { name: "Higgs Boson", type: "concept" }, // not a taggable entity type
      { name: "CERN", type: "org" },
    ],
    primary_entities: [],
  };
  const tags = hashtagsFor(story);
  assert.ok(tags.includes("#CERN"));
  assert.ok(!tags.includes("#HiggsBoson"));
});

// ── appendHashtags ────────────────────────────────────────────────────────────

test("appendHashtags: appends a blank-line-separated block", () => {
  const out = appendHashtags("Caption body here. Visit quydly.com", TECH_STORY);
  assert.match(out, /Caption body here\. Visit quydly\.com\n\n#Tech #Technology #Nvidia/);
  assert.ok(out.startsWith("Caption body here."));
});

test("appendHashtags: stays within the IG 1500-char cap", () => {
  const out = appendHashtags("x".repeat(1490), TECH_STORY);
  assert.ok(out.length <= 1500, `length ${out.length} > 1500`);
});

test("appendHashtags: returns body unchanged when no tag fits", () => {
  const body = "y".repeat(1500);
  assert.equal(appendHashtags(body, TECH_STORY), body);
});

test("appendHashtags: no-op-safe on empty/edge stories", () => {
  // Null story still yields brand tags; an empty body gets no leading separator.
  assert.equal(appendHashtags("", null), "#Quydly #NewsQuiz #DailyNews");
  assert.equal(
    appendHashtags("Body", { primary_entities: [], primary_entities_enriched: [] }),
    "Body\n\n#Quydly #NewsQuiz #DailyNews"
  );
});

// ── integration: IG caption + hashtags passes validation ──────────────────────

test("IG caption with hashtags passes validation (allowHashtags: true)", () => {
  const draft = instagram.format(TECH_STORY, "global");
  const text = appendHashtags(draft.text, TECH_STORY);
  const v = validatePost({ platform: "instagram", text, story: TECH_STORY, constraints: instagram.CONSTRAINTS });
  assert.ok(v.valid, v.errors.join(", "));
});
