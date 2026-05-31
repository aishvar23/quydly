#!/usr/bin/env node
// Unit tests for cashtag derivation + X integration (reach: §8.1).
//
// Usage: node --test test/cashtags.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { cashtagsFor, tickerFor, normaliseOrg } from "../lib/social/platforms/_cashtags.js";
import * as x from "../lib/social/platforms/x.js";
import { validatePost } from "../lib/social/social-validation.js";
import { weightedLength } from "../lib/social/platforms/x.js";

const FINANCE_STORY = {
  id: 1,
  category_id: "finance",
  headline: "Nvidia and AMD shares climb after strong chip demand outlook",
  summary: "Both chipmakers reported rising demand for AI accelerators this quarter.",
  key_points: ["Data-center revenue rose sharply", "Guidance raised for next quarter"],
  source_count: 3,
  primary_entities_enriched: [
    { name: "Nvidia", type: "org", role: "chipmaker" },
    { name: "Advanced Micro Devices", type: "org", role: "chipmaker" },
  ],
  primary_entities: ["Nvidia", "Advanced Micro Devices"],
};

// ── normalisation / lookup ───────────────────────────────────────────────────

test("normaliseOrg: strips corporate suffixes + punctuation", () => {
  assert.equal(normaliseOrg("Apple Inc."), "apple");
  assert.equal(normaliseOrg("Advanced Micro Devices"), "advanced micro devices");
  assert.equal(normaliseOrg("Procter & Gamble Co."), "procter & gamble");
});

test("tickerFor: maps known orgs, null for unknown", () => {
  assert.equal(tickerFor("Apple Inc."), "AAPL");
  assert.equal(tickerFor("Advanced Micro Devices"), "AMD");
  assert.equal(tickerFor("Some Local Bakery"), null);
});

// ── cashtagsFor ──────────────────────────────────────────────────────────────

test("cashtagsFor: finance org entities → cashtags, capped + deduped", () => {
  assert.deepEqual(cashtagsFor(FINANCE_STORY), ["$NVDA", "$AMD"]);
  assert.deepEqual(cashtagsFor(FINANCE_STORY, { max: 1 }), ["$NVDA"]);
});

test("cashtagsFor: empty for non-finance category", () => {
  assert.deepEqual(cashtagsFor({ ...FINANCE_STORY, category_id: "tech" }), []);
});

test("cashtagsFor: empty when no org maps to a ticker", () => {
  const story = {
    category_id: "finance",
    primary_entities_enriched: [{ name: "Local Credit Union", type: "org" }],
    primary_entities: ["Local Credit Union"],
  };
  assert.deepEqual(cashtagsFor(story), []);
});

test("cashtagsFor: ignores person/place entities", () => {
  const story = {
    category_id: "finance",
    primary_entities_enriched: [
      { name: "Jerome Powell", type: "person" },
      { name: "Tesla", type: "org" },
    ],
    primary_entities: [],
  };
  assert.deepEqual(cashtagsFor(story), ["$TSLA"]);
});

// ── X formatter integration ──────────────────────────────────────────────────

test("x.format: appends cashtags after CTA, stays within weighted 280", () => {
  const out = x.format(FINANCE_STORY, "global");
  assert.match(out.text, /\$NVDA/);
  assert.match(out.text, /\$AMD/);
  // Cashtags come after the brand CTA.
  assert.ok(out.text.indexOf("Quydly") < out.text.indexOf("$NVDA"));
  assert.match(out.text, /Quydly/);
  assert.ok(weightedLength(out.text) <= 280, `weighted ${weightedLength(out.text)} > 280`);
});

test("x.format: no cashtags for non-finance stories", () => {
  const out = x.format({ ...FINANCE_STORY, category_id: "world" }, "global");
  assert.ok(!/\$[A-Z]/.test(out.text), "no cashtag on non-finance post");
});

test("x.format output passes validation (cashtags allowed)", () => {
  const out = x.format(FINANCE_STORY, "global");
  const v = validatePost({ platform: "x", text: out.text, story: FINANCE_STORY, constraints: x.CONSTRAINTS });
  assert.ok(v.valid, v.errors.join(", "));
});

// ── validation: hashtags rejected, cashtags allowed ──────────────────────────

test("validatePost: rejects hashtags on X but allows cashtags", () => {
  const base = { story: FINANCE_STORY, constraints: x.CONSTRAINTS, platform: "x" };
  assert.equal(
    validatePost({ ...base, text: "Chip demand rises. Take today's news quiz on Quydly #stocks" }).valid,
    false,
    "hashtag should be rejected"
  );
  assert.equal(
    validatePost({ ...base, text: "Chip demand rises. Take today's news quiz on Quydly\n\n$NVDA $AMD" }).valid,
    true,
    "cashtags should be allowed"
  );
});

test("validatePost: rejects cashtags not in the story's curated set (LLM safety)", () => {
  const base = { story: FINANCE_STORY, constraints: x.CONSTRAINTS, platform: "x" };
  // FINANCE_STORY maps to $NVDA / $AMD only — a hallucinated $TSLA must fail so
  // the orchestrator falls back to the safe deterministic draft.
  const bad = validatePost({ ...base, text: "Chips up. Take today's news quiz on Quydly\n\n$TSLA" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /unexpected cashtag "\$TSLA"/.test(e)), bad.errors.join(", "));

  // A correct subset still passes.
  assert.equal(
    validatePost({ ...base, text: "Chips up. Take today's news quiz on Quydly\n\n$NVDA" }).valid,
    true
  );
});

test("validatePost: rejects any cashtag on a non-finance X post", () => {
  const story = { ...FINANCE_STORY, category_id: "world" }; // empty allowed set
  const v = validatePost({ platform: "x", constraints: x.CONSTRAINTS, story,
    text: "Markets move. Take today's news quiz on Quydly\n\n$NVDA" });
  assert.equal(v.valid, false);
});

test("validatePost: dollar amounts are not mistaken for cashtags", () => {
  // "$5" is a number, not a cashtag — must not trip the cashtag allowlist.
  const story = { ...FINANCE_STORY, summary: FINANCE_STORY.summary + " The fund raised $5 today." };
  const v = validatePost({ platform: "x", constraints: x.CONSTRAINTS, story,
    text: "A fund raised $5. Take today's news quiz on Quydly\n\n$NVDA" });
  assert.ok(v.valid, v.errors.join(", "));
});
