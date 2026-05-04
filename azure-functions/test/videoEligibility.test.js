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
