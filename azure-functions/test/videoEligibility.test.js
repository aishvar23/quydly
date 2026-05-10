#!/usr/bin/env node
// Unit tests for azure-functions/lib/videoEligibility.js (P2-3).
//
// Usage: node --test test/videoEligibility.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeVideoEligibility,
  CONFIDENCE_FLOOR_FOR_TEST,
  SENSITIVE_PHRASES_FOR_TEST,
} from "../lib/videoEligibility.js";

// Baseline input that produces eligible: true. Tests modify one field at a
// time so a regression in any single rule shows up as a single test failure.
function eligibleInput(overrides = {}) {
  return {
    confidence_score:  9,
    editorial_posture: "tally_official",
    headline:          "Manhattan jury convicts founder on seven counts",
    summary:           "A federal court issued the verdict after a six-week trial.",
    diversity:         { label: "diverse", domain_count: 4 },
    article_count:     5,
    ...overrides,
  };
}

test("P2-3 baseline input is eligible", () => {
  const out = computeVideoEligibility(eligibleInput());
  assert.equal(out.eligible, true);
  assert.equal(out.reason, null);
});

test("P2-3 confidence below floor → low_confidence", () => {
  const out = computeVideoEligibility(eligibleInput({ confidence_score: CONFIDENCE_FLOOR_FOR_TEST - 1 }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "low_confidence");
});

test("P2-3 confidence at floor is eligible (boundary inclusive)", () => {
  const out = computeVideoEligibility(eligibleInput({ confidence_score: CONFIDENCE_FLOOR_FOR_TEST }));
  assert.equal(out.eligible, true);
});

test("P2-3 missing / non-numeric confidence → low_confidence", () => {
  assert.equal(computeVideoEligibility(eligibleInput({ confidence_score: null })).reason, "low_confidence");
  assert.equal(computeVideoEligibility(eligibleInput({ confidence_score: "high" })).reason, "low_confidence");
});

test("P2-3 article_count = 0 → no_articles", () => {
  const out = computeVideoEligibility(eligibleInput({ article_count: 0 }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "no_articles");
});

test("P2-3 breaking_developing posture with single domain → developing_single_source", () => {
  const out = computeVideoEligibility(eligibleInput({
    editorial_posture: "breaking_developing",
    diversity: { label: "single", domain_count: 1 },
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "developing_single_source");
});

test("P2-3 breaking_developing with ≥2 domains is eligible", () => {
  const out = computeVideoEligibility(eligibleInput({
    editorial_posture: "breaking_developing",
    diversity: { label: "diverse", domain_count: 3 },
  }));
  assert.equal(out.eligible, true);
});

test("P2-3 single-source coverage (non-developing) → single_source_coverage", () => {
  const out = computeVideoEligibility(eligibleInput({
    editorial_posture: "tally_official",
    diversity: { label: "single", domain_count: 1 },
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "single_source_coverage");
});

test("P2-3 sensitive subject in headline → sensitive_subject", () => {
  // Spot-check a representative entry from each sensitivity bucket.
  const triggers = ["suicide", "rape", "child sexual", "mass shooting"];
  for (const phrase of triggers) {
    const out = computeVideoEligibility(eligibleInput({
      headline: `Statement on ${phrase} case released today`,
    }));
    assert.equal(out.eligible, false, `phrase "${phrase}" must trip sensitive_subject`);
    assert.equal(out.reason, "sensitive_subject");
  }
});

test("P2-3 sensitive phrase in summary triggers even when headline is clean", () => {
  const out = computeVideoEligibility(eligibleInput({
    headline: "Court issues final ruling on long-running case",
    summary:  "The verdict followed testimony about prior child abuse allegations.",
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "sensitive_subject");
});

test("P2-3 every advertised sensitive phrase trips the gate", () => {
  // Defends against accidental drift — adding a phrase to the public list
  // without it actually firing in the rule chain.
  for (const phrase of SENSITIVE_PHRASES_FOR_TEST) {
    const out = computeVideoEligibility(eligibleInput({
      headline: `breaking: ${phrase} reported in today's news`,
    }));
    assert.equal(out.reason, "sensitive_subject", `${phrase} must trip the gate`);
  }
});

test("P2-3 first matching rule wins — confidence beats single-source beats sensitivity", () => {
  // A story can fail multiple rules; the editor sees the most-specific
  // reason, which for the rule order means earliest wins.
  const out = computeVideoEligibility(eligibleInput({
    confidence_score: 3,
    diversity: { label: "single", domain_count: 1 },
    headline: "report on suicide pact",
  }));
  assert.equal(out.reason, "low_confidence",
    "earliest rule (confidence) should win over later rules");
});

test("P2-3 case-insensitive sensitive phrase match", () => {
  const out = computeVideoEligibility(eligibleInput({
    headline: "BREAKING: SUICIDE statement released",
  }));
  assert.equal(out.reason, "sensitive_subject");
});

// ── Gate 6: no_enriched_entities (story 181 root cause) ─────────────────────

test("eligibility: primary_entities populated but enriched=[] → no_enriched_entities", () => {
  // Story 181 shape: synth emitted 10 names but enrichment LLM failed,
  // leaving the renderer with no way to resolve images.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Dinesh Trivedi", "Pranay Verma", "Bangladesh"],
    primary_entities_enriched: [],
    story_type:                "geopolitics_world",
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "no_enriched_entities");
});

test("eligibility: finance_markets is exempt from no_enriched_entities", () => {
  // Finance stories lean on NumberCard / data-plate visuals; missing
  // entity portraits are not the show-stopper they are for geopolitics.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Federal Reserve", "Powell"],
    primary_entities_enriched: [],
    story_type:                "finance_markets",
  }));
  assert.equal(out.eligible, true);
  assert.equal(out.reason, null);
});

test("eligibility: enriched populated → no_enriched_entities does not fire", () => {
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Vijay"],
    primary_entities_enriched: [{ name: "Vijay", type: "person" }],
    story_type:                "geopolitics_world",
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: no_enriched_entities does not fire when primary_entities is also empty", () => {
  // Honest "no entity signal" should not be conflated with "synth bug".
  // Other gates (low_confidence etc.) catch the real-empty case.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          [],
    primary_entities_enriched: [],
    story_type:                "geopolitics_world",
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: legacy callers (no enriched fields passed) keep previous behaviour", () => {
  // Backward compatibility — the eligibleInput baseline does not pass
  // enriched fields and must remain eligible.
  const out = computeVideoEligibility(eligibleInput());
  assert.equal(out.eligible, true);
  assert.equal(out.reason, null);
});

// ── Gate 7: single_country_outside_theatre (story 222 shape) ────────────────

test("eligibility: ≥2 primary_geos with all sources outside theatre → single_country_outside_theatre", () => {
  // Story 222: U.S./Iran/Pakistan story sourced 6/6 from India.
  const out = computeVideoEligibility(eligibleInput({
    primary_geos: ["us", "ir", "pk"],
    source_documents: [
      { source_country: "in" },
      { source_country: "in" },
      { source_country: "in" },
      { source_country: "in" },
    ],
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "single_country_outside_theatre");
});

test("eligibility: single source country INSIDE the theatre is acceptable", () => {
  // India-only sources on a story whose primary_geos include India = ok.
  // The collapse only matters when no source comes from any named country.
  const out = computeVideoEligibility(eligibleInput({
    primary_geos: ["in", "bd"],
    source_documents: [
      { source_country: "in" },
      { source_country: "in" },
      { source_country: "in" },
    ],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: multi-country sources do not trip the gate (≥2 distinct countries)", () => {
  const out = computeVideoEligibility(eligibleInput({
    primary_geos: ["us", "ir"],
    source_documents: [
      { source_country: "in" },
      { source_country: "us" },
    ],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: single primary_geo never trips outside-theatre (rule needs ≥2)", () => {
  // The rule is specifically about multi-country stories. A single-country
  // story where all sources sit in another country is a different concern
  // (caught elsewhere if at all).
  const out = computeVideoEligibility(eligibleInput({
    primary_geos: ["us"],
    source_documents: [{ source_country: "in" }],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: gate ordering — no_enriched_entities beats single_country", () => {
  // Both rules can fire; the earlier one in the chain wins.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Vijay"],
    primary_entities_enriched: [],
    story_type:                "geopolitics_world",
    primary_geos:              ["us", "ir"],
    source_documents:          [{ source_country: "in" }, { source_country: "in" }],
  }));
  assert.equal(out.reason, "no_enriched_entities");
});

// ── Gate 8: visual_starvation (playbook §1 visual asset rule of thumb) ──────

test("eligibility: no resolved portraits + no geos + <2 concepts → visual_starvation", () => {
  // Worst-case row: no Wikipedia hits, no country signal, no concept
  // stock. The video would render 100% placeholders by construction.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Acme Inc."],
    primary_entities_enriched: [{ name: "Acme Inc.", type: "org", wiki_resolved: false }],
    story_type:                "general",
    primary_geos:              [],
    source_documents:          [{ source_country: "us" }],
    visual_concepts:           [],
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "visual_starvation");
});

test("eligibility: one wiki_resolved portrait WITH thumbnail URL satisfies the visual gate", () => {
  // Person photo via Wikipedia is priority 1 of the rule of thumb.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Vijay"],
    primary_entities_enriched: [{ name: "Vijay", type: "person", wiki_resolved: true, wikipedia_thumbnail_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/v.jpg" }],
    story_type:                "geopolitics_world",
    primary_geos:              [],
    visual_concepts:           [],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: wiki_resolved=true WITHOUT any portrait URL does NOT satisfy the gate", () => {
  // Gate 8 checks that a usable image URL is present, not just that
  // wiki_resolved is truthy. An entity resolved with no URL cannot be
  // displayed by the renderer and should not count as visually safe.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Vijay"],
    primary_entities_enriched: [{ name: "Vijay", type: "person", wiki_resolved: true }],
    story_type:                "geopolitics_world",
    primary_geos:              [],
    visual_concepts:           [],
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "visual_starvation");
});

test("eligibility: portrait_thumbnail_url override satisfies the visual gate", () => {
  // stampOverride() sets portrait_thumbnail_url; gate must accept it as
  // a usable portrait source alongside wikipedia_thumbnail_url.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Vijay"],
    primary_entities_enriched: [{ name: "Vijay", type: "person", wiki_resolved: true, portrait_thumbnail_url: "https://press.example.com/vijay-thumb.jpg" }],
    story_type:                "geopolitics_world",
    primary_geos:              [],
    visual_concepts:           [],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: portrait_image_url override satisfies the visual gate", () => {
  // stampOverride() also sets portrait_image_url; gate must accept it.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Vijay"],
    primary_entities_enriched: [{ name: "Vijay", type: "person", wiki_resolved: true, portrait_image_url: "https://press.example.com/vijay-full.jpg" }],
    story_type:                "geopolitics_world",
    primary_geos:              [],
    visual_concepts:           [],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: a primary_geo (country flag fallback) satisfies the visual gate", () => {
  // Country flag is priority 2 — even with zero resolved entities and
  // zero concepts, a known country gives the renderer something honest
  // to draw.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Acme Inc."],
    primary_entities_enriched: [{ name: "Acme Inc.", type: "org", wiki_resolved: false }],
    story_type:                "geopolitics_world",
    primary_geos:              ["us"],
    visual_concepts:           [],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: ≥2 visual_concepts satisfies the visual gate (concept stock)", () => {
  // Priority 3 — bank, parliament, oil rig, etc. Two-concept threshold
  // means the row has at least one fallback per non-hook module on a
  // typical 4-6 module plan.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Acme Inc."],
    primary_entities_enriched: [{ name: "Acme Inc.", type: "org", wiki_resolved: false }],
    story_type:                "general",
    primary_geos:              [],
    visual_concepts:           ["Manhattan federal courthouse", "DOJ logo"],
  }));
  assert.equal(out.eligible, true);
});

test("eligibility: a single visual_concept is NOT enough (one beat ≠ a video)", () => {
  // Threshold is ≥2 — a single concept stocks only one beat and the rest
  // would still placeholder.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Acme Inc."],
    primary_entities_enriched: [{ name: "Acme Inc.", type: "org", wiki_resolved: false }],
    story_type:                "general",
    primary_geos:              [],
    visual_concepts:           ["one solitary courthouse"],
  }));
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "visual_starvation");
});

test("eligibility: gate ordering — no_enriched_entities still beats visual_starvation", () => {
  // Empty enriched array AND no geos AND no concepts — both gates would
  // trigger. The chain runs no_enriched_entities first.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Acme Inc."],
    primary_entities_enriched: [],
    story_type:                "general",
    primary_geos:              [],
    visual_concepts:           [],
  }));
  assert.equal(out.reason, "no_enriched_entities");
});

test("eligibility: visual_starvation only fires when caller passes all three fields", () => {
  // Backward compatibility — pre-2026-05-09 callers don't pass
  // visual_concepts. The gate must not over-fire on partial inputs.
  const out = computeVideoEligibility(eligibleInput({
    primary_entities:          ["Acme Inc."],
    primary_entities_enriched: [{ name: "Acme Inc.", type: "org", wiki_resolved: false }],
    primary_geos:              [],
    // visual_concepts not passed
  }));
  assert.equal(out.eligible, true);
});
