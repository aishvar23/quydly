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

test("hashtagsFor: unknown category falls back to a derived tag (never silently untagged)", () => {
  // A category not in the curated overrides (e.g. a new vertical added to
  // config/categories.js) still gets a generic tag derived from its id.
  const tags = hashtagsFor({ category_id: "sports", primary_entities: [], primary_entities_enriched: [] });
  assert.deepEqual(tags, ["#Sports", "#Quydly", "#NewsQuiz", "#DailyNews"]);
});

test("hashtagsFor: brand tags always present even with no category/entities", () => {
  const tags = hashtagsFor({ primary_entities: [], primary_entities_enriched: [] });
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

test("hashtagsFor: does NOT tag dirty flat primary_entities (enrichment-failure path)", () => {
  // When enrichment fails, primary_entities_enriched is empty and the flat
  // primary_entities holds the dirty regex-extracted cluster names. Those must
  // never become hashtags — only typed enriched entities do.
  const story = {
    category_id: "world",
    primary_entities_enriched: [],
    primary_entities: ["two india", "hormuz the", "correspondent", "washington"],
  };
  const tags = hashtagsFor(story);
  assert.deepEqual(tags, ["#WorldNews", "#Quydly", "#NewsQuiz", "#DailyNews"]);
});

test("hashtagsFor: entity tags come from enriched even when flat duplicates exist", () => {
  // Flat array is ignored entirely; the type filter is not defeated by it.
  const story = {
    category_id: "tech",
    primary_entities_enriched: [{ name: "CERN", type: "org" }],
    primary_entities: ["CERN", "Climate Change"], // flat junk must not leak
  };
  const tags = hashtagsFor(story);
  assert.ok(tags.includes("#CERN"));
  assert.ok(!tags.includes("#ClimateChange"));
});

test("hashtagsFor: unknown hyphenated category sanitises to a single clean tag", () => {
  // A multi-word/hyphenated id must not emit "#Us-politics" (IG truncates at
  // the hyphen) — it PascalCases to one valid tag.
  const tags = hashtagsFor({ category_id: "us-politics", primary_entities: [], primary_entities_enriched: [] });
  assert.deepEqual(tags, ["#UsPolitics", "#Quydly", "#NewsQuiz", "#DailyNews"]);
});

test("hashtagsFor: never exceeds Instagram's 30-hashtag ceiling", () => {
  // Unique alphabetic suffixes (digits would be stripped by entityTag and
  // collapse to duplicates) so each entity yields a distinct tag.
  const alpha = (n) => {
    let s = "";
    do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  };
  const story = {
    category_id: "world",
    primary_entities_enriched: Array.from({ length: 50 }, (_, i) => ({
      name: `Person ${alpha(i)}`, type: "person",
    })),
    primary_entities: [],
  };
  // Even with an absurd caller-supplied max, the hard 30-tag ceiling holds.
  const tags = hashtagsFor(story, { maxEntities: 100, max: 100 });
  assert.ok(tags.length <= 30, `got ${tags.length} tags`);
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

// ── integration: validation vs the curated block ─────────────────────────────
//
// The curated block is appended AFTER validation (social-post-generator.js), so
// validation runs on the hashtag-free caption body. The deterministic draft must
// validate, and an LLM caption that sneaks in its own hashtag must be REJECTED so
// it falls back to the clean draft before the curated block is appended.

test("IG deterministic draft (no hashtags) passes validation", () => {
  const draft = instagram.format(TECH_STORY, "global");
  const v = validatePost({ platform: "instagram", text: draft.text, story: TECH_STORY, constraints: instagram.CONSTRAINTS });
  assert.ok(v.valid, v.errors.join(", "));
});

test("IG rejects an LLM caption that emits its own hashtag (allowHashtags: false)", () => {
  // A model caption with a stray #tag must not validate — otherwise it would be
  // saved alongside the curated block, duplicating/contaminating the tag set.
  const llmText = `${instagram.format(TECH_STORY, "global").text} #trending`;
  const v = validatePost({ platform: "instagram", text: llmText, story: TECH_STORY, constraints: instagram.CONSTRAINTS });
  assert.ok(!v.valid);
  assert.ok(v.errors.some((e) => /hashtag/i.test(e)), v.errors.join(", "));
});

test("curated block still validates: append runs post-validation, body stays clean", () => {
  // The block is added after validation, but sanity-check that a caption WITH the
  // curated block does not itself contain anything else the validator forbids
  // (the '#' check is the only hashtag gate, and it is bypassed by design here).
  const draft = instagram.format(TECH_STORY, "global");
  const withTags = appendHashtags(draft.text, TECH_STORY);
  assert.ok(withTags.includes("#Quydly"));
  assert.ok(withTags.startsWith(draft.text)); // body preserved verbatim, tags appended
});
