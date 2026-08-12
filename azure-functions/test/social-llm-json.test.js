#!/usr/bin/env node
// Unit tests for parseJSONFromLLM (lib/social/mcq.js) — no network.
//
// Usage: node --test test/social-llm-json.test.js
//
// Regression for the 2026-07-24 incident: Claude wrapped the JSON in prose
// ("Looking at this story… {…}") or appended text after the closing brace, the
// naive JSON.parse threw, and IG carousels silently lost their "Why it matters"
// block and editorial illustrations — weak covers were then held for review.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseJSONFromLLM } from "../lib/social/mcq.js";

test("plain JSON object parses unchanged", () => {
  assert.deepEqual(parseJSONFromLLM('{"points":["a","b"]}'), { points: ["a", "b"] });
});

test("```json fenced block parses (pre-existing behaviour)", () => {
  assert.deepEqual(parseJSONFromLLM('```json\n{"scene":"a candle"}\n```'), { scene: "a candle" });
});

test("prose preamble before the JSON object (live failure 2026-07-24)", () => {
  const text = 'Looking at this story, here are the key points:\n{"points":["AI spend doubled","costs hit budgets"]}';
  assert.deepEqual(parseJSONFromLLM(text), { points: ["AI spend doubled", "costs hit budgets"] });
});

test("trailing text after the JSON object (live failure 2026-07-24)", () => {
  const text = '{"scenes":["a rocket over a hospital","a glowing chip"]}\n\nThese scenes avoid real people.';
  assert.deepEqual(parseJSONFromLLM(text), { scenes: ["a rocket over a hospital", "a glowing chip"] });
});

test("preamble AND trailing text around the object", () => {
  const text = 'Sure! Here is the JSON you asked for:\n{"hook":"AI in orbit","highlight":"orbit"}\nLet me know if you need edits.';
  assert.deepEqual(parseJSONFromLLM(text), { hook: "AI in orbit", highlight: "orbit" });
});

test("nested braces and braces inside strings survive extraction", () => {
  const text = 'Note: {"a":{"b":"x } y"},"c":"{"} trailing';
  assert.deepEqual(parseJSONFromLLM(text), { a: { b: "x } y" }, c: "{" });
});

test("escaped quotes inside strings survive extraction", () => {
  const text = 'Answer: {"q":"He said \\"stop\\""} done';
  assert.deepEqual(parseJSONFromLLM(text), { q: 'He said "stop"' });
});

test("no JSON object at all still throws SyntaxError", () => {
  assert.throws(() => parseJSONFromLLM("I cannot produce JSON for this."), SyntaxError);
});

test("unclosed object still throws SyntaxError (original error preserved)", () => {
  assert.throws(() => parseJSONFromLLM('prefix {"a": [1, 2'), SyntaxError);
});

test("empty / null input throws like before", () => {
  assert.throws(() => parseJSONFromLLM(""), SyntaxError);
  assert.throws(() => parseJSONFromLLM(null), SyntaxError);
});
