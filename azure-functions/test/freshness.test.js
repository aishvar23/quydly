#!/usr/bin/env node
// Unit tests for azure-functions/lib/freshness.js (P2-6).
//
// Usage: node --test test/freshness.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeStoryDecayAt,
  decayDaysFor,
  DEFAULT_DECAY_DAYS,
  CATEGORY_DECAY_DAYS_FOR_TEST,
} from "../lib/freshness.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

test("P2-6 decayDaysFor: known categories return their configured window", () => {
  assert.equal(decayDaysFor("world"),   CATEGORY_DECAY_DAYS_FOR_TEST.world);
  assert.equal(decayDaysFor("tech"),    CATEGORY_DECAY_DAYS_FOR_TEST.tech);
  assert.equal(decayDaysFor("finance"), CATEGORY_DECAY_DAYS_FOR_TEST.finance);
  assert.equal(decayDaysFor("culture"), CATEGORY_DECAY_DAYS_FOR_TEST.culture);
  assert.equal(decayDaysFor("science"), CATEGORY_DECAY_DAYS_FOR_TEST.science);
});

test("P2-6 decayDaysFor: unknown / null / non-string falls back to default", () => {
  assert.equal(decayDaysFor("not_a_category"), DEFAULT_DECAY_DAYS);
  assert.equal(decayDaysFor(null),             DEFAULT_DECAY_DAYS);
  assert.equal(decayDaysFor(undefined),        DEFAULT_DECAY_DAYS);
  assert.equal(decayDaysFor(""),               DEFAULT_DECAY_DAYS);
  assert.equal(decayDaysFor(123),              DEFAULT_DECAY_DAYS);
});

test("P2-6 decayDaysFor: case-insensitive on category id", () => {
  assert.equal(decayDaysFor("WORLD"),   CATEGORY_DECAY_DAYS_FOR_TEST.world);
  assert.equal(decayDaysFor("Finance"), CATEGORY_DECAY_DAYS_FOR_TEST.finance);
});

test("P2-6 computeStoryDecayAt: returns published_at + N days for known category", () => {
  const published = "2026-05-01T12:00:00.000Z";
  const got       = computeStoryDecayAt("world", published);
  const expected  = new Date(Date.parse(published) + CATEGORY_DECAY_DAYS_FOR_TEST.world * ONE_DAY_MS).toISOString();
  assert.equal(got, expected);
});

test("P2-6 computeStoryDecayAt: accepts Date objects as well as ISO strings", () => {
  const published = new Date("2026-05-01T12:00:00.000Z");
  const got       = computeStoryDecayAt("tech", published);
  const expected  = new Date(published.getTime() + CATEGORY_DECAY_DAYS_FOR_TEST.tech * ONE_DAY_MS).toISOString();
  assert.equal(got, expected);
});

test("P2-6 computeStoryDecayAt: unknown category uses default window", () => {
  const published = "2026-05-01T00:00:00.000Z";
  const got       = computeStoryDecayAt("not_a_category", published);
  const expected  = new Date(Date.parse(published) + DEFAULT_DECAY_DAYS * ONE_DAY_MS).toISOString();
  assert.equal(got, expected);
});

test("P2-6 computeStoryDecayAt: null / unparseable published_at returns null", () => {
  assert.equal(computeStoryDecayAt("world", null),         null);
  assert.equal(computeStoryDecayAt("world", undefined),    null);
  assert.equal(computeStoryDecayAt("world", "not a date"), null);
});

test("P2-6 computeStoryDecayAt: faster categories decay before slower categories", () => {
  // Sanity guard against accidental swap — culture (21d) should always decay
  // before science (90d) for the same publication time.
  const published = "2026-05-01T00:00:00.000Z";
  const culture   = Date.parse(computeStoryDecayAt("culture", published));
  const science   = Date.parse(computeStoryDecayAt("science", published));
  assert.ok(culture < science, `culture (${culture}) must decay before science (${science})`);
});
