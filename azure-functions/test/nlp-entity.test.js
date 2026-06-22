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
});

test("normalizeEntity: bare title with no name is NOT stripped to empty", () => {
  assert.equal(normalizeEntity("Prime Minister"), "prime minister");
  assert.equal(normalizeEntity("President"), "president");
});

test("normalizeEntity: org names that begin with a role word are preserved", () => {
  // These role words are deliberately excluded from the prefix list precisely
  // because stripping them would corrupt organisation entities.
  assert.equal(normalizeEntity("General Motors"), "general motors");
  assert.equal(normalizeEntity("Justice Department"), "justice department");
  assert.equal(normalizeEntity("Captain America"), "captain america");
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
