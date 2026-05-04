#!/usr/bin/env node
// Unit tests for the data-quality additions in story-synthesizer.
//
// Usage: node --test test/synthesizer-data.test.js
//
// Covers items P0-1 (source_documents snapshot), P0-2 (verbatim quote
// extraction + verification), and P0-3 (readable place names) from
// docs/data-pipeline-improvements-tracker.md.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceDocuments,
  mergeSourceDocuments,
  extractQuotes,
} from "../story-synthesizer/index.js";
import { resolvePrimaryPlaces, countryCodeToName } from "../lib/places.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeArticles() {
  return [
    {
      id: 10,
      title: "Court rules on landmark crypto case",
      description: "SDNY courthouse decision.",
      content: 'Judge Lewis Kaplan said, "The defendant orchestrated one of the largest financial frauds in American history."',
      domain: "reuters.com",
      canonical_url: "https://reuters.com/article-10",
      published_at: "2026-04-01T10:00:00Z",
      author: "Jane Doe",
      mentioned_geos: ["us"],
      source_country: "us",
      authority_score: 0.9,
    },
    {
      id: 11,
      title: "FTX founder sentenced",
      description: null,
      content: 'Bankman-Fried told the court, "I made a series of bad decisions and I am sorry for the harm caused."',
      domain: "wsj.com",
      canonical_url: "https://wsj.com/article-11",
      published_at: "2026-04-01T11:00:00Z",
      author: null,
      mentioned_geos: ["us"],
      source_country: "us",
      authority_score: 0.85,
    },
  ];
}

// ── P0-1: buildSourceDocuments ────────────────────────────────────────────────

test("P0-1 buildSourceDocuments projects core fields onto each article", () => {
  const docs = buildSourceDocuments(makeArticles());
  assert.equal(docs.length, 2);
  assert.deepEqual(docs[0], {
    id:             "10",
    type:           "article",
    title:          "Court rules on landmark crypto case",
    issuer:         "reuters.com",
    url:            "https://reuters.com/article-10",
    date:           "2026-04-01T10:00:00Z",
    authority:      0.9,
    source_country: "us",
  });
  // ids stringified for JSON stability
  assert.equal(typeof docs[0].id, "string");
});

test("P0-1 buildSourceDocuments tolerates missing optional fields", () => {
  const docs = buildSourceDocuments([{ id: 99, title: "x", domain: "x.com" }]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, "99");
  assert.equal(docs[0].url, null);
  assert.equal(docs[0].date, null);
  assert.equal(docs[0].authority, 0);
});

test("P0-2 buildSourceDocuments attaches verbatim quotes to the matching source doc only", () => {
  const articles = makeArticles();
  const verbatimQuotes = [
    {
      source_id: 10,
      text: "The defendant orchestrated one of the largest financial frauds in American history.",
      speaker: "Lewis Kaplan",
      role: "judge",
    },
  ];
  const docs = buildSourceDocuments(articles, verbatimQuotes);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].quote_text, verbatimQuotes[0].text);
  assert.equal(docs[0].quote_speaker, "Lewis Kaplan");
  assert.equal(docs[0].quote_role, "judge");
  // Article 11 must NOT pick up article 10's quote
  assert.equal(docs[1].quote_text, undefined);
  assert.equal(docs[1].quote_speaker, undefined);
});

test("P0-2 buildSourceDocuments drops quotes whose source_id does not match any article", () => {
  const articles = makeArticles();
  const verbatimQuotes = [
    { source_id: 9999, text: "Orphan quote", speaker: "Nobody" },
  ];
  const docs = buildSourceDocuments(articles, verbatimQuotes);
  for (const d of docs) {
    assert.equal(d.quote_text, undefined);
  }
});

// ── P0-1: mergeSourceDocuments ────────────────────────────────────────────────

test("P0-1 mergeSourceDocuments dedupes by id and prefers incoming fields when both exist", () => {
  const existing = [
    { id: "10", title: "old title", issuer: "reuters.com" },
    { id: "20", title: "from prior synthesis", issuer: "ap.com" },
  ];
  const incoming = [
    { id: "10", title: "new title", issuer: "reuters.com", url: "https://reuters.com/x" },
    { id: "30", title: "fresh", issuer: "bbc.com" },
  ];
  const merged = mergeSourceDocuments(existing, incoming);
  assert.equal(merged.length, 3, "dedupe: id 10 appears once");
  const byId = Object.fromEntries(merged.map(d => [d.id, d]));
  assert.equal(byId["10"].title, "new title", "incoming overwrites existing");
  assert.equal(byId["10"].url, "https://reuters.com/x");
  assert.equal(byId["20"].title, "from prior synthesis", "prior-only entries preserved");
  assert.equal(byId["30"].title, "fresh", "new entries added");
});

test("P0-1 mergeSourceDocuments handles non-array existing (first River merge)", () => {
  const incoming = [{ id: "10", title: "new" }];
  const merged = mergeSourceDocuments(undefined, incoming);
  assert.deepEqual(merged, incoming);
  const merged2 = mergeSourceDocuments(null, incoming);
  assert.deepEqual(merged2, incoming);
});

// ── P0-2: extractQuotes verbatim verification ─────────────────────────────────

function makeStubAi(text) {
  return {
    messages: {
      create: async () => ({ content: [{ text }] }),
    },
  };
}

test("P0-2 extractQuotes accepts quotes that appear verbatim in their claimed source", async () => {
  const articles = makeArticles();
  const llmResponse = JSON.stringify([
    {
      source_index: 1,
      text: "The defendant orchestrated one of the largest financial frauds in American history.",
      speaker: "Lewis Kaplan",
      role: "judge",
    },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].source_id, 10);
  assert.equal(verified[0].speaker, "Lewis Kaplan");
  assert.equal(verified[0].role, "judge");
});

test("P0-2 extractQuotes rejects paraphrased quotes that do not appear verbatim", async () => {
  const articles = makeArticles();
  const llmResponse = JSON.stringify([
    {
      source_index: 1,
      text: "The defendant orchestrated the biggest financial fraud ever seen.",
      speaker: "Lewis Kaplan",
      role: "judge",
    },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 0, "paraphrased quote must not pass the verbatim guard");
});

test("P0-2 extractQuotes verbatim check tolerates curly-quote and whitespace drift", async () => {
  const articles = [
    {
      id: 7,
      title: "t",
      content: "She said, “The plan goes into effect on Monday.”",
      domain: "x.com",
    },
  ];
  const llmResponse = JSON.stringify([
    {
      source_index: 1,
      text: 'The plan goes into effect on Monday.',
      speaker: "She",
    },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 1, "smart quotes in source must not block a straight-quote LLM response");
});

test("P0-2 extractQuotes rejects out-of-range source_index values", async () => {
  const articles = makeArticles();
  const llmResponse = JSON.stringify([
    { source_index: 99, text: "anything", speaker: "x" },
    { source_index: 0,  text: "anything", speaker: "x" },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 0);
});

test("P0-2 extractQuotes returns [] on malformed LLM JSON without throwing", async () => {
  const verified = await extractQuotes(makeStubAi("not json"), makeArticles());
  assert.deepEqual(verified, []);
});

test("P0-2 extractQuotes drops too-short quotes", async () => {
  const articles = [{ id: 1, title: "ok ok ok", content: "ok yes", domain: "x.com" }];
  const llmResponse = JSON.stringify([
    { source_index: 1, text: "ok yes", speaker: "Speaker" },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 0, "below-minimum-words quotes filtered out");
});

// ── P0-3: place name resolution ──────────────────────────────────────────────

test("P0-3 countryCodeToName resolves common ISO codes", () => {
  assert.equal(countryCodeToName("us"), "United States");
  assert.equal(countryCodeToName("IN"), "India");
  assert.equal(countryCodeToName(" gb "), "United Kingdom");
  assert.equal(countryCodeToName("zz"), null);
  assert.equal(countryCodeToName(null), null);
  assert.equal(countryCodeToName(""), null);
});

test("P0-3 resolvePrimaryPlaces returns parallel structure with names where known", () => {
  const places = resolvePrimaryPlaces(["us", "in", "zz"]);
  assert.deepEqual(places, [
    { code: "us", name: "United States" },
    { code: "in", name: "India" },
    { code: "zz", name: null },
  ]);
});

test("P0-3 resolvePrimaryPlaces handles empty / missing input", () => {
  assert.deepEqual(resolvePrimaryPlaces(undefined), []);
  assert.deepEqual(resolvePrimaryPlaces(null), []);
  assert.deepEqual(resolvePrimaryPlaces([]), []);
});
