// Unit tests for entity extraction title-prefix stripping (Starmer 3-way dup fix).
//
// Run: node --test test/nlp-entity.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractEntities, normalizeEntity, isSpecificNamedEntity } from "../lib/nlp.js";

// ── normalizeEntity: leading personal titles are stripped ────────────────────

test("normalizeEntity: strips 'Prime Minister' so the residual name matches", () => {
  // This is the exact 3-way "Starmer resigns" duplication: one article's
  // headline carried the office title, another did not.
  assert.equal(normalizeEntity("Prime Minister Keir Starmer"), "keir starmer");
  assert.equal(normalizeEntity("Keir Starmer"), "keir starmer");
});

test("normalizeEntity: strips a range of clearly-personal titles", () => {
  assert.equal(normalizeEntity("President Macron"), "macron");
  assert.equal(normalizeEntity("Chancellor Merz"), "merz");
  assert.equal(normalizeEntity("Vice President Vance"), "vance");
  assert.equal(normalizeEntity("Deputy Prime Minister Rayner"), "rayner");
  // Starmer is actually "Sir Keir Starmer" — `sir` must strip.
  assert.equal(normalizeEntity("Sir Keir Starmer"), "keir starmer");
});

test("normalizeEntity: bare title with no name is NOT stripped to empty", () => {
  assert.equal(normalizeEntity("Prime Minister"), "prime minister");
  assert.equal(normalizeEntity("President"), "president");
});

test("normalizeEntity: org / brand / competition / place names are preserved", () => {
  // Role words that commonly begin a non-person entity are deliberately excluded
  // from the prefix list — stripping them would corrupt the entity into a generic
  // noun (the code-review collateral findings).
  assert.equal(normalizeEntity("General Motors"), "general motors");
  assert.equal(normalizeEntity("Justice Department"), "justice department");
  assert.equal(normalizeEntity("Captain America"), "captain america");
  assert.equal(normalizeEntity("Premier League"), "premier league"); // not "league"
  assert.equal(normalizeEntity("Doctor Who"), "doctor who");          // not "who"
  assert.equal(normalizeEntity("Dr Pepper"), "dr pepper");            // not "pepper"
  assert.equal(normalizeEntity("Sheikh Hasina"), "sheikh hasina");    // not "hasina"
});

// ── extractEntities: same person, two headline forms → same token ────────────

test("extractEntities: titled and untitled headlines yield the same person token", () => {
  const a = extractEntities("Prime Minister Keir Starmer resigns amid Labour pressure");
  const b = extractEntities("Keir Starmer quits as Labour leader");
  assert.ok(a.includes("keir starmer"), `expected 'keir starmer' in ${JSON.stringify(a)}`);
  assert.ok(b.includes("keir starmer"), `expected 'keir starmer' in ${JSON.stringify(b)}`);
});

// ── isSpecificNamedEntity: the cross-category merge gate predicate ────────────

test("isSpecificNamedEntity: multi-word names and non-generic singles are specific", () => {
  assert.equal(isSpecificNamedEntity("keir starmer"), true);
  assert.equal(isSpecificNamedEntity("openai"), true);
});

test("isSpecificNamedEntity: broad regions and generic singles are NOT specific", () => {
  assert.equal(isSpecificNamedEntity("us"), false);
  assert.equal(isSpecificNamedEntity("ai"), false);
  assert.equal(isSpecificNamedEntity("middle east"), false);
});

test("isSpecificNamedEntity: generic multi-word boilerplate is NOT specific", () => {
  // A space alone must not make a phrase "specific" — else two unrelated stories
  // sharing only "general election" + one name would satisfy the cross-category
  // merge gate.
  assert.equal(isSpecificNamedEntity("general election"), false);
  assert.equal(isSpecificNamedEntity("supreme court"), false);
  assert.equal(isSpecificNamedEntity("trade war"), false);
  assert.equal(isSpecificNamedEntity("prime minister"), false);
});
