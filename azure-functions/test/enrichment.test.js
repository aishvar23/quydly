#!/usr/bin/env node
// Unit tests for azure-functions/lib/enrichment.js (P0-5 + P1 batch).
//
// Usage: node --test test/enrichment.test.js
//
// Tests focus on the validator: structurally-bad LLM output must be coerced
// to safe defaults rather than fail the whole synthesis. The LLM call itself
// is stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  enrichNarrative,
  emptyEnrichment,
  enrichmentSucceeded,
  STORY_TYPES,
  EDITORIAL_POSTURES,
  ENTITY_TYPES,
} from "../lib/enrichment.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStubAi(text) {
  return {
    messages: {
      create: async () => ({ content: [{ text }] }),
    },
  };
}

function makeStubAiThatThrows() {
  return {
    messages: {
      create: async () => { throw new Error("simulated upstream failure"); },
    },
  };
}

function makeArticles() {
  return [
    { id: 10, title: "A", domain: "a.com", content: "Article ten body" },
    { id: 11, title: "B", domain: "b.com", content: "Article eleven body" },
  ];
}

function makeNarrative() {
  return {
    headline:   "Defendant sentenced to 25 years in record fraud case",
    summary:    "A federal judge handed down a 25-year sentence after a jury convicted the defendant on seven counts.",
    key_points: ["25 years", "Seven counts", "$8 billion in customer funds"],
  };
}

const validResponse = JSON.stringify({
  story_type:        "legal_scandal",
  editorial_posture: "indictment_alleged",
  hook_sentence:     "A federal judge sentenced the disgraced founder to twenty five years today.",
  why_it_matters:    "It signals the courts will jail crypto founders for fraud, not just fine them.",
  structured_numbers: {
    money:       [{ display: "$8 billion", value: 8000000000, role: "alleged take" }],
    counts:      [{ display: "25 years", value: 25, unit: "years", label: "sentence" }],
    percentages: [],
    magnitudes:  [],
    casualties:  [],
  },
  timeline_events: [
    { date: "2024-03-28", label: "Sentenced to 25 years", source_id: 10 },
    { date: "2023-11-02", label: "Convicted on seven counts", source_id: 11 },
  ],
  primary_entities_enriched: [
    { name: "Sam Bankman-Fried", type: "person", role: "defendant", context: "Former CEO of crypto exchange FTX." },
    { name: "FTX", type: "org", role: "subject company" },
    { name: "Manhattan", type: "place", role: "courthouse location" },
  ],
});

// ── Happy path ────────────────────────────────────────────────────────────────

test("enrichment: valid LLM response is passed through with all fields", async () => {
  const result = await enrichNarrative(makeStubAi(validResponse), { primary_entities: ["sam bankman-fried", "ftx"], category_id: "us-news" }, makeArticles(), makeNarrative());
  assert.equal(result.story_type, "legal_scandal");
  assert.equal(result.editorial_posture, "indictment_alleged");
  assert.match(result.hook_sentence, /federal judge/);
  assert.match(result.why_it_matters, /jail crypto founders/);
  assert.equal(result.structured_numbers.money.length, 1);
  assert.equal(result.structured_numbers.money[0].value, 8000000000);
  assert.equal(result.timeline_events.length, 2);
  assert.equal(result.primary_entities_enriched.length, 3);
  assert.equal(result.primary_entities_enriched[0].context, "Former CEO of crypto exchange FTX.");
});

// ── Failure resilience ────────────────────────────────────────────────────────

test("enrichment: never throws on upstream LLM error — returns empty enrichment", async () => {
  const result = await enrichNarrative(makeStubAiThatThrows(), {}, makeArticles(), makeNarrative());
  assert.deepEqual(result, emptyEnrichment());
});

test("enrichment: invalid JSON body returns empty enrichment without throwing", async () => {
  const result = await enrichNarrative(makeStubAi("not json"), {}, makeArticles(), makeNarrative());
  assert.deepEqual(result, emptyEnrichment());
});

test("enrichment: empty articles short-circuits to empty enrichment", async () => {
  let called = false;
  const ai = { messages: { create: async () => { called = true; return { content: [{ text: validResponse }] }; } } };
  const result = await enrichNarrative(ai, {}, [], makeNarrative());
  assert.equal(called, false);
  assert.deepEqual(result, emptyEnrichment());
});

// ── Story type / posture closed sets ──────────────────────────────────────────

test("enrichment: story_type drift falls back to 'general'", async () => {
  const body = JSON.stringify({ story_type: "crypto_megafraud" });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.story_type, "general");
});

test("enrichment: every advertised story_type passes validation", async () => {
  for (const t of STORY_TYPES) {
    const result = await enrichNarrative(makeStubAi(JSON.stringify({ story_type: t })), {}, makeArticles(), makeNarrative());
    assert.equal(result.story_type, t, `story_type ${t} should pass through`);
  }
});

test("enrichment: every advertised editorial_posture passes validation", async () => {
  for (const p of EDITORIAL_POSTURES) {
    const result = await enrichNarrative(makeStubAi(JSON.stringify({ editorial_posture: p })), {}, makeArticles(), makeNarrative());
    assert.equal(result.editorial_posture, p, `editorial_posture ${p} should pass through`);
  }
});

test("enrichment: invalid editorial_posture coerces to null", async () => {
  const body = JSON.stringify({ editorial_posture: "vibes_based_speculation" });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.editorial_posture, null);
});

// ── Hook sentence guard ───────────────────────────────────────────────────────

test("enrichment: hook with question mark is rejected (must be declarative)", async () => {
  const body = JSON.stringify({ hook_sentence: "Did the defendant get the maximum sentence today in court?" });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.hook_sentence, null, "question hooks must reject");
});

test("enrichment: hook below or above word range rejects", async () => {
  const tooShort = JSON.stringify({ hook_sentence: "Sentencing today." });
  const tooLong  = JSON.stringify({ hook_sentence: Array(40).fill("word").join(" ") });
  assert.equal((await enrichNarrative(makeStubAi(tooShort), {}, makeArticles(), makeNarrative())).hook_sentence, null);
  assert.equal((await enrichNarrative(makeStubAi(tooLong),  {}, makeArticles(), makeNarrative())).hook_sentence, null);
});

// ── Structured numbers validation ─────────────────────────────────────────────

test("enrichment: structured numbers — non-numeric value is dropped", async () => {
  const body = JSON.stringify({
    structured_numbers: {
      money:       [{ display: "$8 billion", value: "eight billion" }],
      counts:      [{ display: "25 years", value: 25 }],
      percentages: [],
      magnitudes:  [],
      casualties:  [],
    },
  });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.structured_numbers.money.length, 0, "string value must reject");
  assert.equal(result.structured_numbers.counts.length, 1);
});

test("enrichment: structured numbers — missing display field is dropped", async () => {
  const body = JSON.stringify({
    structured_numbers: {
      money:       [{ value: 8000000000, role: "alleged take" }],
      counts:      [],
      percentages: [],
      magnitudes:  [],
      casualties:  [],
    },
  });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.structured_numbers.money.length, 0);
});

// ── Timeline event validation ─────────────────────────────────────────────────

test("enrichment: timeline events — invalid date format is dropped", async () => {
  const body = JSON.stringify({
    timeline_events: [
      { date: "March 28, 2024", label: "Sentenced", source_id: 10 },
      { date: "2024-03-28",      label: "Sentenced", source_id: 10 },
    ],
  });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.timeline_events.length, 1);
  assert.equal(result.timeline_events[0].date, "2024-03-28");
});

test("enrichment: timeline events — source_id outside cluster's article ids is nulled", async () => {
  const body = JSON.stringify({
    timeline_events: [
      { date: "2024-03-28", label: "Sentenced", source_id: 9999 }, // not in articles 10, 11
    ],
  });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.timeline_events.length, 1);
  assert.equal(result.timeline_events[0].source_id, null,
    "hallucinated source ids must null out — not be silently kept");
});

// ── Entity validation ─────────────────────────────────────────────────────────

test("enrichment: entity with unknown type is dropped", async () => {
  const body = JSON.stringify({
    primary_entities_enriched: [
      { name: "FTX", type: "company" },                  // 'company' not in ENTITY_TYPES
      { name: "Manhattan", type: "place" },
    ],
  });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.primary_entities_enriched.length, 1);
  assert.equal(result.primary_entities_enriched[0].name, "Manhattan");
});

test("enrichment: entity types — every advertised type passes validation", async () => {
  const body = JSON.stringify({
    primary_entities_enriched: ENTITY_TYPES.map((t, i) => ({ name: `Entity${i}`, type: t })),
  });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.primary_entities_enriched.length, ENTITY_TYPES.length);
});

test("enrichment: entity context too long is truncated", async () => {
  const longContext = "x".repeat(500);
  const body = JSON.stringify({
    primary_entities_enriched: [
      { name: "Sam Bankman-Fried", type: "person", role: "defendant", context: longContext },
    ],
  });
  const result = await enrichNarrative(makeStubAi(body), {}, makeArticles(), makeNarrative());
  assert.equal(result.primary_entities_enriched.length, 1);
  assert.ok(result.primary_entities_enriched[0].context.length <= 280, "context must clamp to 280 chars");
});

// ── Default shape contract ────────────────────────────────────────────────────

test("enrichment: emptyEnrichment exposes all expected keys for downstream writers", () => {
  const e = emptyEnrichment();
  assert.equal(e.story_type, "general");
  assert.equal(e.editorial_posture, null);
  assert.equal(e.hook_sentence, null);
  assert.equal(e.why_it_matters, null);
  assert.deepEqual(Object.keys(e.structured_numbers).sort(), ["casualties", "counts", "magnitudes", "money", "percentages"]);
  assert.deepEqual(e.structured_numbers.money, []);
  assert.deepEqual(e.timeline_events, []);
  assert.deepEqual(e.primary_entities_enriched, []);
});

// ── Codex P1 fix: enrichmentSucceeded marker ─────────────────────────────────

test("enrichmentSucceeded: empty fallback is NOT marked succeeded", () => {
  // Critical: this is the gate that prevents River-merge from overwriting a
  // previously-enriched row when the current run's enrichment LLM failed.
  assert.equal(enrichmentSucceeded(emptyEnrichment()), false);
  assert.equal(enrichmentSucceeded(null), false);
  assert.equal(enrichmentSucceeded(undefined), false);
  assert.equal(enrichmentSucceeded({}), false);
});

test("enrichmentSucceeded: marks true on a successful enrichNarrative call", async () => {
  const result = await enrichNarrative(makeStubAi(validResponse), {}, makeArticles(), makeNarrative());
  assert.equal(enrichmentSucceeded(result), true);
});

test("enrichmentSucceeded: stays false when LLM throws", async () => {
  const result = await enrichNarrative(makeStubAiThatThrows(), {}, makeArticles(), makeNarrative());
  assert.equal(enrichmentSucceeded(result), false);
});

test("enrichmentSucceeded: stays false on invalid JSON response", async () => {
  const result = await enrichNarrative(makeStubAi("not json at all"), {}, makeArticles(), makeNarrative());
  assert.equal(enrichmentSucceeded(result), false);
});

test("enrichment: _ok marker is non-enumerable — does not leak through spread or JSON", async () => {
  // The synthesizer writes `{ ...buildEnrichmentColumns(enrichment, ...) }`
  // into the Supabase payload. If `_ok` were enumerable, it would attempt
  // to write a column named `_ok` and the row write would fail (or worse,
  // succeed and leave a phantom column).
  const result = await enrichNarrative(makeStubAi(validResponse), {}, makeArticles(), makeNarrative());
  assert.equal(Object.keys(result).includes("_ok"), false, "Object.keys must not list _ok");
  assert.equal(Object.entries(result).some(([k]) => k === "_ok"), false, "Object.entries must not list _ok");
  const json = JSON.parse(JSON.stringify(result));
  assert.equal("_ok" in json, false, "JSON.stringify must drop _ok");
  const spread = { ...result };
  assert.equal("_ok" in spread, false, "object spread must drop _ok");
  // But direct read still returns true so callers can gate on it.
  assert.equal(result._ok, true);
});
