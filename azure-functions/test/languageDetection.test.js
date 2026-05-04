#!/usr/bin/env node
// Unit tests for azure-functions/lib/languageDetection.js (P2-4).
//
// Usage: node --test test/languageDetection.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectScriptLanguages,
  aggregateArticleLanguages,
  SCRIPT_MIN_HITS_FOR_TEST,
} from "../lib/languageDetection.js";

// ── detectScriptLanguages ────────────────────────────────────────────────────

test("P2-4 detectScriptLanguages: pure English returns []", () => {
  assert.deepEqual(detectScriptLanguages("The defendant was sentenced today."), []);
});

test("P2-4 detectScriptLanguages: empty / non-string input safe", () => {
  assert.deepEqual(detectScriptLanguages(""), []);
  assert.deepEqual(detectScriptLanguages(null), []);
  assert.deepEqual(detectScriptLanguages(undefined), []);
  assert.deepEqual(detectScriptLanguages(42), []);
});

test("P2-4 detectScriptLanguages: paragraph of Devanagari → ['hi']", () => {
  // ~30 Devanagari codepoints, well above the 8-hit threshold.
  const text = "मोदी ने आज एक बड़ी रैली में भाषण दिया। यह घटना दिल्ली में हुई।";
  assert.deepEqual(detectScriptLanguages(text), ["hi"]);
});

test("P2-4 detectScriptLanguages: paragraph of Arabic → ['ar']", () => {
  const text = "أعلن الرئيس عن خطة جديدة لإصلاح الاقتصاد الوطني هذا الأسبوع";
  assert.deepEqual(detectScriptLanguages(text), ["ar"]);
});

test("P2-4 detectScriptLanguages: paragraph of CJK → ['zh']", () => {
  const text = "中华人民共和国国务院今日发布关于经济政策的重要声明文件";
  assert.deepEqual(detectScriptLanguages(text), ["zh"]);
});

test("P2-4 detectScriptLanguages: paragraph of Cyrillic → ['ru']", () => {
  const text = "Президент России выступил с заявлением о международной политике";
  assert.deepEqual(detectScriptLanguages(text), ["ru"]);
});

test("P2-4 detectScriptLanguages: mixed scripts return all detected", () => {
  // English wrapper with substantial Hindi quote AND Arabic byline.
  const text = "He said: मोदी ने आज एक बड़ी रैली में भाषण दिया। يخاطب الجماهير في الميدان مرارا";
  const detected = detectScriptLanguages(text);
  assert.ok(detected.includes("hi"), "Hindi must detect");
  assert.ok(detected.includes("ar"), "Arabic must detect");
});

test("P2-4 detectScriptLanguages: stray glyph below threshold does NOT trigger", () => {
  // A single Devanagari brand name ("निर्माण") in an otherwise English
  // article should NOT flip the flag — too few codepoints.
  const text = "The brand निर्माण announced its annual report.";
  const detected = detectScriptLanguages(text);
  // 6 Devanagari codepoints in "निर्माण" — below the 8-hit threshold.
  assert.deepEqual(detected, [], "single-word foreign brand must not trigger");
  assert.equal(SCRIPT_MIN_HITS_FOR_TEST, 8, "threshold is the documented value");
});

// ── aggregateArticleLanguages ────────────────────────────────────────────────

test("P2-4 aggregateArticleLanguages: all-English articles → translation_required=false", () => {
  const result = aggregateArticleLanguages([
    { language: "en", title: "Story A", content: "English content here." },
    { language: "en", title: "Story B", content: "More English content." },
  ]);
  assert.deepEqual(result.original_languages, ["en"]);
  assert.equal(result.translation_required, false);
});

test("P2-4 aggregateArticleLanguages: any non-English feed lang → translation_required=true", () => {
  const result = aggregateArticleLanguages([
    { language: "en", title: "Wire copy",   content: "Standard reporting." },
    { language: "hi", title: "Hindi feed",  content: "...some content..." },
  ]);
  assert.deepEqual(result.original_languages.sort(), ["en", "hi"]);
  assert.equal(result.translation_required, true);
});

test("P2-4 aggregateArticleLanguages: feed says en but body has Devanagari → flag triggers", () => {
  // The story 170-style scenario: NDTV article tagged en, but body
  // includes a paragraph-length Hindi quote. Script detection catches it.
  const result = aggregateArticleLanguages([
    {
      language: "en",
      title:    "Modi addresses crowd",
      content:  "He said in Hindi: मोदी ने आज एक बड़ी रैली में भाषण दिया। यह घटना दिल्ली में हुई।",
    },
  ]);
  assert.ok(result.original_languages.includes("en"), "feed lang preserved");
  assert.ok(result.original_languages.includes("hi"), "body script detected");
  assert.equal(result.translation_required, true);
});

test("P2-4 aggregateArticleLanguages: empty / null inputs safe", () => {
  assert.deepEqual(
    aggregateArticleLanguages([]),
    { original_languages: [], translation_required: false },
  );
  assert.deepEqual(
    aggregateArticleLanguages(null),
    { original_languages: [], translation_required: false },
  );
});

test("P2-4 aggregateArticleLanguages: dedupes + sorts language list", () => {
  const result = aggregateArticleLanguages([
    { language: "ru" },
    { language: "EN" },
    { language: "ru" },
    { language: "fr" },
    { language: "en" },
  ]);
  // Lowercased + deduped + sorted.
  assert.deepEqual(result.original_languages, ["en", "fr", "ru"]);
  assert.equal(result.translation_required, true, "non-en feeds must flag");
});

test("P2-4 aggregateArticleLanguages: missing language field doesn't crash", () => {
  const result = aggregateArticleLanguages([
    { title: "no lang", content: "Plain English content." },
    { language: null, title: "explicit null" },
  ]);
  assert.deepEqual(result.original_languages, []);
  assert.equal(result.translation_required, false);
});
