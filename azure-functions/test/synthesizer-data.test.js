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
  attachWikipediaToEntities,
  quoteHasCompleteTail,
  mergeEntityAndClusterGeos,
  cleanPrimaryEntities,
  countEntityOverlap,
  tolerantEntityOverlap,
  pickRelatedStories,
  relatedStoryCutoff,
} from "../story-synthesizer/index.js";
import { resolvePrimaryPlaces, countryCodeToName } from "../lib/places.js";
import { _resetCache as resetWikipediaCache } from "../lib/wikipedia.js";

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
  // P4-1: every doc carries explicit null on the three quote fields so
  // mergeSourceDocuments can distinguish "this synth ran the validator
  // and no quote attached" (clear) from "this synth didn't touch quotes"
  // (preserve).
  assert.deepEqual(docs[0], {
    id:             "10",
    type:           "article",
    title:          "Court rules on landmark crypto case",
    issuer:         "reuters.com",
    url:            "https://reuters.com/article-10",
    date:           "2026-04-01T10:00:00Z",
    authority:      0.9,
    source_country: "us",
    // 2026-05-09: byline persisted so source-diversity / video gate-2a
    // can detect same-author concentration across the source set.
    author:         "Jane Doe",
    quote_text:     null,
    quote_speaker:  null,
    quote_role:     null,
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
  // Article 11 must NOT pick up article 10's quote.
  // P4-1: docs without an attached quote now carry explicit null on all
  // three quote fields (was: undefined). The explicit null is the signal
  // mergeSourceDocuments uses to clear stale quote data from prior synth
  // runs — distinct from "this synth didn't touch quotes" (absent).
  assert.equal(docs[1].quote_text, null);
  assert.equal(docs[1].quote_speaker, null);
  assert.equal(docs[1].quote_role, null);
});

test("P0-2 buildSourceDocuments drops quotes whose source_id does not match any article", () => {
  const articles = makeArticles();
  const verbatimQuotes = [
    { source_id: 9999, text: "Orphan quote", speaker: "Nobody" },
  ];
  const docs = buildSourceDocuments(articles, verbatimQuotes);
  // P4-1: explicit null on all three fields means "validator ran, no quote".
  for (const d of docs) {
    assert.equal(d.quote_text, null);
    assert.equal(d.quote_speaker, null);
    assert.equal(d.quote_role, null);
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

// ── P4-1: tri-state quote semantics on River merge ──────────────────────────

test("P4-1 mergeSourceDocuments: explicit quote_text:null clears prior quote (Ghalibaf regression)", () => {
  // Reproduces story 170: prior synth stored a truncated Ghalibaf quote;
  // new synth's P3-2 tail validator rejects it. buildSourceDocuments
  // emits the doc with quote_text:null. Merge must wipe ALL prior quote
  // fields (not just quote_text), since they're a tuple.
  const existing = [
    {
      id: "93656", title: "Ghalibaf statement", issuer: "x.com",
      quote_text:    "...by the naval blockade and",
      quote_speaker: "Mohammad Bagher Ghalibaf",
      quote_role:    "Iran's parliament speaker",
    },
  ];
  const incoming = [
    {
      id: "93656", title: "Ghalibaf statement", issuer: "x.com",
      // P4-1 contract: explicit null on all three quote fields.
      quote_text: null, quote_speaker: null, quote_role: null,
    },
  ];
  const merged = mergeSourceDocuments(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quote_text,    null, "stale quote_text must clear");
  assert.equal(merged[0].quote_speaker, null, "stale speaker must clear");
  assert.equal(merged[0].quote_role,    null, "stale role must clear");
});

test("P4-1 mergeSourceDocuments: absent quote fields preserve prior (no accidental clear)", () => {
  // Some other code path (not buildSourceDocuments) might emit a doc
  // without quote fields at all. That means "I'm not touching quotes" —
  // prior values must survive.
  const existing = [
    { id: "10", title: "old", quote_text: "Real quote", quote_speaker: "Person" },
  ];
  const incoming = [
    { id: "10", title: "updated" },  // no quote_text field at all
  ];
  const merged = mergeSourceDocuments(existing, incoming);
  assert.equal(merged[0].quote_text,    "Real quote", "absent → preserve");
  assert.equal(merged[0].quote_speaker, "Person");
});

test("P4-1 mergeSourceDocuments: incoming quote_text string overwrites prior value", () => {
  const existing = [
    { id: "10", quote_text: "old quote", quote_speaker: "old speaker" },
  ];
  const incoming = [
    { id: "10", quote_text: "fresh quote", quote_speaker: "fresh speaker", quote_role: "fresh role" },
  ];
  const merged = mergeSourceDocuments(existing, incoming);
  assert.equal(merged[0].quote_text,    "fresh quote");
  assert.equal(merged[0].quote_speaker, "fresh speaker");
  assert.equal(merged[0].quote_role,    "fresh role");
});

test("P4-1 mergeSourceDocuments: end-to-end with buildSourceDocuments — rejection clears prior", () => {
  // Story 170 scenario: prior synth had 2 quotes attached. New synth's
  // validator rejects one of them. buildSourceDocuments emits both docs;
  // the rejected one has quote_text:null. Merge against the prior story
  // row must wipe the rejected quote, keep the verified one.
  const articles = [
    { id: 100, title: "Sailor interview",        domain: "x.com", authority_score: 0.6 },
    { id: 200, title: "Ghalibaf truncated",      domain: "y.com", authority_score: 0.6 },
  ];
  const verifiedQuotes = [
    { source_id: 100, text: "Verified quote.", speaker: "Sailor", role: "crew" },
    // Doc 200 — no verified quote this run (P3-2 rejected the truncated one).
  ];
  const newDocs = buildSourceDocuments(articles, verifiedQuotes);

  const priorStored = [
    { id: "100", title: "Sailor interview", quote_text: "Verified quote.", quote_speaker: "Sailor" },
    { id: "200", title: "Ghalibaf truncated", quote_text: "...by the naval blockade and", quote_speaker: "Ghalibaf", quote_role: "speaker" },
  ];

  const merged = mergeSourceDocuments(priorStored, newDocs);
  const byId = Object.fromEntries(merged.map((d) => [d.id, d]));
  assert.equal(byId["100"].quote_text, "Verified quote.", "verified quote stays");
  assert.equal(byId["200"].quote_text, null, "rejected quote drops");
  assert.equal(byId["200"].quote_speaker, null);
  assert.equal(byId["200"].quote_role, null);
});

// Codex P1 review on PR #72 — regression guard: in the synthesizer's
// River-update path, source diversity must be recomputed from the merged
// source_documents, not from the new cluster's articles alone. Otherwise
// an old multi-domain story stamped with a low-diversity new pickup gets
// silently downgraded.
test("P1-8 merged-source diversity reflects the union, not just the new pickup", async () => {
  const { computeSourceDiversity } = await import("../lib/sourceDiversity.js");

  // Existing story already has 3 distinct, non-wire domains (high diversity)
  const existing = [
    { id: "100", issuer: "nytimes.com",     authority: 0.9 },
    { id: "101", issuer: "bbc.co.uk",       authority: 0.8 },
    { id: "102", issuer: "theguardian.com", authority: 0.7 },
  ];
  // New cluster batch is a single wire pickup — what the buggy path used
  // to score on its own.
  const incoming = [
    { id: "200", issuer: "reuters.com", authority: 0.7 },
  ];

  const merged = mergeSourceDocuments(existing, incoming);
  // The synthesizer maps source-document `issuer` → diversity helper's
  // `domain`. Mirror that exact shape map here.
  const mergedDiversity = computeSourceDiversity(merged.map(d => ({ domain: d.issuer })));

  // Pre-fix bug: code scored only the new wire pickup → label "single".
  // Post-fix: 4 distinct domains, 1 wire / 3 non-wire → "diverse".
  assert.equal(mergedDiversity.domain_count, 4);
  assert.equal(mergedDiversity.wire_count,   1);
  assert.equal(mergedDiversity.label,        "diverse",
    "merge must lift the persisted diversity above what the new pickup alone produces");

  // The pre-fix scenario (incoming-only) lands under "narrow", proving the
  // recomputation matters in real conditions, not just on paper.
  const incomingOnly = computeSourceDiversity(incoming.map(d => ({ domain: d.issuer })));
  assert.ok(incomingOnly.score < mergedDiversity.score,
    `pre-fix score ${incomingOnly.score} should be below merged ${mergedDiversity.score}`);
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

// Codex P1 regression: stripping apostrophes globally lets "we'll" collapse
// to "well", which would let a paraphrased quote slip past the verbatim
// guard. The normaliser must keep apostrophes intact and only fold curly /
// straight typography drift.
test("P0-2 extractQuotes preserves apostrophes — paraphrase that drops a contraction must reject", async () => {
  const articles = [
    { id: 1, title: "t", content: "We'll meet at the courthouse on Monday morning at nine.", domain: "x.com" },
  ];
  const llmResponse = JSON.stringify([
    {
      source_index: 1,
      text: "Well meet at the courthouse on Monday morning at nine.",
      speaker: "Counsel",
    },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 0, "dropping the apostrophe in 'we'll' must not be treated as verbatim");
});

test("P0-2 extractQuotes tolerates curly→straight apostrophe drift in contractions", async () => {
  const articles = [
    // Article uses curly U+2019; LLM returns straight apostrophe.
    { id: 1, title: "t", content: "He said, “We’ll meet at the courthouse on Monday morning.”", domain: "x.com" },
  ];
  const llmResponse = JSON.stringify([
    {
      source_index: 1,
      text: "We'll meet at the courthouse on Monday morning.",
      speaker: "He",
    },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 1, "curly apostrophe in source must accept matching straight-apostrophe LLM output");
});

// ── P0-1: deterministic ordering by authority (Codex P2) ─────────────────────

test("P0-1 buildSourceDocuments orders entries by authority desc with stable id tiebreak", () => {
  const articles = [
    { id: 30, title: "low",  domain: "low.com",  authority_score: 0.4 },
    { id: 10, title: "high", domain: "high.com", authority_score: 0.9 },
    { id: 20, title: "mid",  domain: "mid.com",  authority_score: 0.7 },
    { id: 11, title: "high2", domain: "high2.com", authority_score: 0.9 }, // tiebreak vs id 10
  ];
  const docs = buildSourceDocuments(articles);
  assert.deepEqual(docs.map(d => d.id), ["10", "11", "20", "30"],
    "highest authority first, then ascending id within ties");
});

test("P0-1 mergeSourceDocuments re-sorts by authority after dedup", () => {
  const existing = [
    { id: "30", title: "old-low",  authority: 0.4 },
    { id: "10", title: "old-high", authority: 0.6 }, // should be overwritten by incoming with higher authority
  ];
  const incoming = [
    { id: "20", title: "new-mid",  authority: 0.7 },
    { id: "10", title: "new-high", authority: 0.9 }, // upgrades the entry
  ];
  const merged = mergeSourceDocuments(existing, incoming);
  assert.deepEqual(merged.map(d => d.id), ["10", "20", "30"]);
  const byId = Object.fromEntries(merged.map(d => [d.id, d]));
  assert.equal(byId["10"].authority, 0.9, "incoming authority overrides existing");
  assert.equal(byId["10"].title, "new-high");
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

// ── P0-4: attachWikipediaToEntities ──────────────────────────────────────────

function installFetchStub(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => handler(...args);
  return () => { globalThis.fetch = original; };
}

function jsonResp(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test("P0-4 attachWikipediaToEntities stitches probe metadata onto resolved entries", async () => {
  resetWikipediaCache();
  const restore = installFetchStub(async () =>
    jsonResp(200, {
      type:     "standard",
      title:    "FTX",
      extract:  "FTX is a defunct cryptocurrency exchange.",
      thumbnail: { source: "https://upload.wikimedia.org/.../ftx.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/FTX" } },
    })
  );
  try {
    const out = await attachWikipediaToEntities([
      { name: "FTX", type: "org", role: "subject company" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].wiki_resolved, true);
    assert.equal(out[0].wikipedia_url, "https://en.wikipedia.org/wiki/FTX");
    assert.match(out[0].wikipedia_thumbnail_url, /\/ftx\.jpg$/);
    assert.match(out[0].context, /defunct cryptocurrency/);
  } finally { restore(); }
});

test("P0-4 attachWikipediaToEntities preserves synthesizer-supplied context over Wikipedia summary", async () => {
  resetWikipediaCache();
  const restore = installFetchStub(async () =>
    jsonResp(200, {
      type:     "standard",
      title:    "Sam Bankman-Fried",
      extract:  "Boilerplate Wikipedia opening.",
      thumbnail: { source: "https://upload.wikimedia.org/.../sbf.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Sam_Bankman-Fried" } },
    })
  );
  try {
    const out = await attachWikipediaToEntities([
      { name: "Sam Bankman-Fried", type: "person", role: "defendant", context: "Editor-set context wins." },
    ]);
    assert.equal(out[0].context, "Editor-set context wins.",
      "Wikipedia summary must NOT overwrite a context the synthesizer already supplied");
  } finally { restore(); }
});

test("P0-4 attachWikipediaToEntities surfaces failure metadata without dropping the entity", async () => {
  resetWikipediaCache();
  const restore = installFetchStub(async () => jsonResp(404, {}));
  try {
    const out = await attachWikipediaToEntities([
      { name: "Definitely Not A Real Person 9999", type: "person", role: "ghost" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].wiki_resolved, false);
    assert.equal(out[0].wiki_reason, "not_found");
    assert.equal(out[0].name, "Definitely Not A Real Person 9999",
      "the synthesizer-supplied entity must survive even when Wikipedia rejects");
  } finally { restore(); }
});

test("P0-4 attachWikipediaToEntities returns [] for empty / non-array input", async () => {
  assert.deepEqual(await attachWikipediaToEntities([]), []);
  assert.deepEqual(await attachWikipediaToEntities(null), []);
  assert.deepEqual(await attachWikipediaToEntities(undefined), []);
});

// ── P2-5: portrait override integration with attachWikipediaToEntities ──────

// Stub supabase that returns override rows for given norm keys.
function makeOverrideStubSupabase(rowsByNorm) {
  return {
    from() {
      return {
        select() {
          return {
            in(_col, vals) {
              const data = vals.map((v) => rowsByNorm[v]).filter(Boolean);
              return { data, error: null };
            },
          };
        },
      };
    },
  };
}

test("P2-5 attachWikipediaToEntities: override stamps portrait_* fields and skips Wikipedia probe", async () => {
  resetWikipediaCache();
  // Wikipedia stub would fire if reached — assert it's NOT reached.
  let wikipediaCallCount = 0;
  const restore = installFetchStub(async () => {
    wikipediaCallCount++;
    return jsonResp(200, {
      type: "standard", title: "Donald Trump", extract: "wiki bio",
      thumbnail: { source: "https://upload.wikimedia.org/wiki-trump.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Donald_Trump" } },
    });
  });
  try {
    const supabase = makeOverrideStubSupabase({
      "donald trump": {
        entity_name_norm: "donald trump",
        display_name:     "Donald Trump",
        image_url:        "https://press-photos.example.com/trump-2025.jpg",
        thumbnail_url:    "https://press-photos.example.com/trump-2025-thumb.jpg",
        attribution:      "Reuters / Press Pool",
        license:          "Editorial use only",
      },
    });
    const out = await attachWikipediaToEntities(
      [{ name: "Donald Trump", type: "person", role: "subject" }],
      { supabase },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].portrait_image_url, "https://press-photos.example.com/trump-2025.jpg");
    assert.equal(out[0].portrait_attribution, "Reuters / Press Pool");
    assert.equal(out[0].portrait_license, "Editorial use only");
    assert.equal(out[0].portrait_source, "override");
    assert.equal(out[0].wiki_resolved, true);
    assert.equal(wikipediaCallCount, 0,
      "Wikipedia probe must be skipped for entities with an override match");
  } finally { restore(); }
});

test("P2-5 attachWikipediaToEntities: entities without override still get Wikipedia probe", async () => {
  resetWikipediaCache();
  const restore = installFetchStub(async () =>
    jsonResp(200, {
      type: "standard", title: "Asim Munir", extract: "Pakistan military officer.",
      thumbnail: { source: "https://upload.wikimedia.org/munir.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Asim_Munir" } },
    }),
  );
  try {
    // Override matches only Trump. Munir has no override → Wikipedia probe runs.
    const supabase = makeOverrideStubSupabase({
      "donald trump": {
        entity_name_norm: "donald trump", display_name: "Donald Trump",
        image_url: "https://o/dt.jpg", attribution: "AP", license: "Editorial",
      },
    });
    const out = await attachWikipediaToEntities(
      [
        { name: "Donald Trump", type: "person" },
        { name: "Asim Munir",   type: "person" },
      ],
      { supabase },
    );
    assert.equal(out[0].portrait_source, "override", "Trump uses override");
    assert.equal(out[0].wikipedia_url, undefined, "Trump skips Wikipedia probe");
    assert.match(out[1].wikipedia_url, /Asim_Munir/, "Munir uses Wikipedia probe");
    assert.equal(out[1].portrait_source, undefined, "Munir has no override stamp");
  } finally { restore(); }
});

test("P2-5 attachWikipediaToEntities: no supabase = pre-P2-5 behaviour (only Wikipedia)", async () => {
  resetWikipediaCache();
  const restore = installFetchStub(async () =>
    jsonResp(200, {
      type: "standard", title: "Donald Trump", extract: "wiki bio",
      thumbnail: { source: "https://upload.wikimedia.org/dt.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Donald_Trump" } },
    }),
  );
  try {
    // Calling without supabase mimics existing test imports — no override
    // lookup, only Wikipedia.
    const out = await attachWikipediaToEntities([
      { name: "Donald Trump", type: "person" },
    ]);
    assert.equal(out[0].portrait_source, undefined, "no override fields without supabase");
    assert.match(out[0].wikipedia_url, /Donald_Trump/);
  } finally { restore(); }
});

test("P2-5 attachWikipediaToEntities: override DB error degrades to Wikipedia path", async () => {
  resetWikipediaCache();
  const restore = installFetchStub(async () =>
    jsonResp(200, {
      type: "standard", title: "Donald Trump", extract: "wiki bio",
      thumbnail: { source: "https://upload.wikimedia.org/dt.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Donald_Trump" } },
    }),
  );
  try {
    const failingSupabase = {
      from() {
        return {
          select() {
            return { in() { return { data: null, error: { message: "boom" } }; } };
          },
        };
      },
    };
    const out = await attachWikipediaToEntities(
      [{ name: "Donald Trump", type: "person" }],
      { supabase: failingSupabase },
    );
    assert.equal(out[0].portrait_source, undefined, "no override on DB error");
    assert.match(out[0].wikipedia_url, /Donald_Trump/, "Wikipedia probe runs as fallback");
  } finally { restore(); }
});

// ── P3-2: quote tail validator (story 170 audit) ─────────────────────────────

test("P3-2 quoteHasCompleteTail accepts quotes ending in terminal punctuation", () => {
  assert.equal(quoteHasCompleteTail("This is a complete sentence."), true);
  assert.equal(quoteHasCompleteTail("Is it really?"), true);
  assert.equal(quoteHasCompleteTail("Stop right now!"), true);
  assert.equal(quoteHasCompleteTail("She said 'hello'"), true);
  assert.equal(quoteHasCompleteTail('"Quoted within a quote"'), true);
  assert.equal(quoteHasCompleteTail("Finished mid-thought…"), true, "ellipsis is terminal");
});

test("P3-2 quoteHasCompleteTail rejects quotes ending in coordinating conjunctions", () => {
  // The story 170 case verbatim — Ghalibaf quote truncated at CONTENT_TRUNCATE.
  assert.equal(
    quoteHasCompleteTail("A full ceasefire only makes sense if it is not violated by the naval blockade and"),
    false,
    "story 170: trailing 'and' must reject",
  );
  assert.equal(quoteHasCompleteTail("We tried but"), false);
  assert.equal(quoteHasCompleteTail("Fight or"), false);
});

test("P3-2 quoteHasCompleteTail rejects quotes ending in articles or prepositions", () => {
  assert.equal(quoteHasCompleteTail("They walked into the"), false);
  assert.equal(quoteHasCompleteTail("Looking for a"), false);
  assert.equal(quoteHasCompleteTail("Heading to"), false);
  assert.equal(quoteHasCompleteTail("Concerned about"), false);
  assert.equal(quoteHasCompleteTail("Brought together with"), false);
});

test("P3-2 quoteHasCompleteTail rejects quotes ending in dangling auxiliaries", () => {
  assert.equal(quoteHasCompleteTail("The verdict is"), false);
  assert.equal(quoteHasCompleteTail("She has"), false);
  assert.equal(quoteHasCompleteTail("They will"), false);
  assert.equal(quoteHasCompleteTail("It must"), false);
});

test("P3-2 quoteHasCompleteTail accepts quotes ending in non-blocklisted words", () => {
  assert.equal(quoteHasCompleteTail("This signals real progress"), true);
  assert.equal(quoteHasCompleteTail("The verdict came down today"), true);
});

test("P3-2 quoteHasCompleteTail tolerates trailing punctuation on the last word", () => {
  // Comma / semicolon after a content word should still be acceptable —
  // the word itself isn't a "more sentence to come" marker.
  assert.equal(quoteHasCompleteTail("we accept the verdict,"), true);
  assert.equal(quoteHasCompleteTail("tense moment;"), true);
  // But comma after a blocklisted word still rejects.
  assert.equal(quoteHasCompleteTail("we walked to the,"), false);
});

test("P3-2 quoteHasCompleteTail rejects empty / non-string / whitespace-only", () => {
  assert.equal(quoteHasCompleteTail(""), false);
  assert.equal(quoteHasCompleteTail("   "), false);
  assert.equal(quoteHasCompleteTail(null), false);
  assert.equal(quoteHasCompleteTail(undefined), false);
  assert.equal(quoteHasCompleteTail(42), false);
});

test("P3-2 quoteHasCompleteTail is case-insensitive on the last word", () => {
  assert.equal(quoteHasCompleteTail("we walked into THE"), false);
  assert.equal(quoteHasCompleteTail("The Verdict Is"), false);
});

test("P3-2 extractQuotes integrates the tail validator — rejects trailing 'and'", async () => {
  // Reuses makeArticles() / makeStubAi from earlier in this file.
  const articles = makeArticles();
  // Build an article whose body ends mid-sentence on 'and' — mirrors what
  // CONTENT_TRUNCATE does on a real article. The LLM faithfully extracts
  // the leading verbatim fragment.
  articles.push({
    id: 12,
    title: "Ghalibaf statement",
    description: null,
    content: "Iran's parliament speaker Mohammad Bagher Ghalibaf declared today: A full ceasefire only makes sense if it is not violated by the naval blockade and",
    domain: "irna.ir",
  });
  const llmResponse = JSON.stringify([
    {
      source_index: 3,
      text: "A full ceasefire only makes sense if it is not violated by the naval blockade and",
      speaker: "Mohammad Bagher Ghalibaf",
      role: "Iran's parliament speaker",
    },
  ]);
  const verified = await extractQuotes(makeStubAi(llmResponse), articles);
  assert.equal(verified.length, 0,
    "P3-2 must reject the truncated quote even though it's verbatim");
});

test("P3-2 extractQuotes still accepts complete quotes after the new gate", async () => {
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
  assert.equal(verified.length, 1, "complete-tail quote must still pass");
});

// ── P3-1: entity-derived geos prepend cluster geos at synthesis time ────────

test("P3-1 mergeEntityAndClusterGeos: entity-tagged places lead, cluster geos follow", () => {
  // Story 170 shape: cluster aggregation produced ["in"] (publisher heavy).
  // Synthesis LLM tagged Iran, Strait of Hormuz, India as places. Entity
  // signal prepends, cluster signal follows, dedupe applied.
  const merged = mergeEntityAndClusterGeos(
    ["in"],
    [
      { name: "Donald Trump", type: "person" },
      { name: "Iran", type: "place" },
      { name: "Strait of Hormuz", type: "place" },
      { name: "India", type: "place" },
    ],
  );
  assert.equal(merged[0], "ir", "Iran (entity) must lead — drives MapCallout");
  assert.ok(merged.includes("in"), "India still present (entity tag + cluster signal both)");
});

test("P3-1 mergeEntityAndClusterGeos: dedupe — entity overrides cluster position but only appears once", () => {
  const merged = mergeEntityAndClusterGeos(
    ["us", "in"],
    [{ name: "Iran", type: "place" }, { name: "United States", type: "place" }],
  );
  // Entities lead: ir, us. Cluster geos that aren't already there append: in.
  assert.deepEqual(merged, ["ir", "us", "in"]);
});

test("P3-1 mergeEntityAndClusterGeos: ignores non-place entity types", () => {
  const merged = mergeEntityAndClusterGeos(
    ["in"],
    [
      { name: "Iran", type: "org" },        // misclassified as org, not place
      { name: "Donald Trump", type: "person" },
    ],
  );
  // Iran is not a place type → ignored. Cluster's "in" still appears.
  assert.deepEqual(merged, ["in"]);
});

test("P3-1 mergeEntityAndClusterGeos: ignores place names not in the gazetteer", () => {
  const merged = mergeEntityAndClusterGeos(
    ["us"],
    [
      { name: "Some Obscure Hamlet", type: "place" },
      { name: "Mumbai", type: "place" },
    ],
  );
  // Mumbai resolves via India aliases; obscure name doesn't.
  assert.deepEqual(merged.sort(), ["in", "us"].sort());
  assert.equal(merged[0], "in", "entity-tagged Mumbai prepends ahead of cluster's us");
});

test("P3-1 mergeEntityAndClusterGeos: empty / null inputs are safe", () => {
  assert.deepEqual(mergeEntityAndClusterGeos(null, null), []);
  assert.deepEqual(mergeEntityAndClusterGeos([], []), []);
  assert.deepEqual(mergeEntityAndClusterGeos(["in"], null), ["in"]);
  assert.deepEqual(mergeEntityAndClusterGeos(null, [{ name: "Iran", type: "place" }]), ["ir"]);
});

test("P3-1 mergeEntityAndClusterGeos: caps at 5", () => {
  const entities = ["Iran", "United States", "China", "Russia", "Israel", "Japan"]
    .map((name) => ({ name, type: "place" }));
  const merged = mergeEntityAndClusterGeos(["in", "pk"], entities);
  assert.ok(merged.length <= 5);
});

// ── P3-5: cleanPrimaryEntities (story 170 audit follow-up) ──────────────────

test("P3-5 cleanPrimaryEntities: enriched names replace dirty cluster array", () => {
  // Story 170 case verbatim — cluster.primary_entities is full of NLP
  // garbage; primary_entities_enriched is clean.
  const dirty = [
    "pakistan field marshal asim",
    "middle east news",
    "two india",
    "correspondent",
    "washington",
    "surviving",
  ];
  const enriched = [
    { name: "Donald Trump",     type: "person" },
    { name: "Asim Munir",       type: "person" },
    { name: "Strait of Hormuz", type: "place"  },
    { name: "Iran",             type: "place"  },
  ];
  const out = cleanPrimaryEntities(enriched, dirty);
  assert.deepEqual(out, ["Donald Trump", "Asim Munir", "Strait of Hormuz", "Iran"]);
  // No noise tokens survive.
  for (const noise of dirty) assert.ok(!out.includes(noise), `noise ${noise} must be dropped`);
});

test("P3-5 cleanPrimaryEntities: falls back to cluster array when enrichment is empty", () => {
  // Enrichment failed (or LLM returned nothing). We don't want to write []
  // — that would erase entity-overlap signal for the next River-merge attempt.
  // Fall back to the dirty cluster array as a least-bad option.
  const dirty = ["asim munir", "donald trump"];
  assert.deepEqual(cleanPrimaryEntities([], dirty), dirty);
  assert.deepEqual(cleanPrimaryEntities(null, dirty), dirty);
  assert.deepEqual(cleanPrimaryEntities(undefined, dirty), dirty);
});

test("P3-5 cleanPrimaryEntities: dedupes case-insensitively, preserves first proper-cased form", () => {
  const enriched = [
    { name: "Donald Trump", type: "person" },
    { name: "donald trump", type: "person" },  // dup
    { name: "Iran", type: "place" },
  ];
  assert.deepEqual(cleanPrimaryEntities(enriched, []), ["Donald Trump", "Iran"]);
});

test("P3-5 cleanPrimaryEntities: caps at 10 entities", () => {
  const enriched = Array.from({ length: 15 }, (_, i) => ({ name: `Entity ${i}`, type: "person" }));
  assert.equal(cleanPrimaryEntities(enriched, []).length, 10);
});

test("P3-5 cleanPrimaryEntities: drops empty / non-string names", () => {
  const enriched = [
    { name: "Iran", type: "place" },
    { name: "",     type: "place" },
    { name: null,   type: "place" },
    { name: 42,     type: "place" },
    { name: "  ",   type: "place" },
    { name: "Real Name", type: "person" },
  ];
  assert.deepEqual(cleanPrimaryEntities(enriched, []), ["Iran", "Real Name"]);
});

// Codex P2 fix on PR #80 — when enrichment RAN successfully (input
// non-empty) but every entry got filtered (e.g. all names blank),
// cleanPrimaryEntities must NOT fall back to the dirty cluster array.
// The validator's verdict ("nothing valid here") wins over noise.
test("P3-5 cleanPrimaryEntities: enrichment ran but yielded nothing usable → empty (NO fallback to dirty cluster)", () => {
  const enriched = [
    { name: "" },
    { name: null },
    { name: "  " },
  ];
  const dirty = ["pakistan field marshal asim", "two india", "correspondent"];
  assert.deepEqual(cleanPrimaryEntities(enriched, dirty), [],
    "successful-but-empty enrichment must not resurrect the dirty cluster array");
});

// ── countEntityOverlap (Codex P2 fix on PR #80) ──────────────────────────────

test("P3-5 countEntityOverlap: case-insensitive matches on both sides", () => {
  // Cluster-side lowercased, story-side proper-cased — the post-P3-5
  // transition state. Both should resolve to the same normalised token.
  assert.equal(
    countEntityOverlap(
      ["asim munir", "donald trump", "iran"],
      ["Asim Munir", "Donald Trump", "Iran"],
    ),
    3,
  );
});

test("P3-5 countEntityOverlap: ≥ 2 shared with no false matches", () => {
  assert.equal(
    countEntityOverlap(
      ["asim munir", "donald trump", "ftx"],
      ["Asim Munir", "Donald Trump", "Sam Bankman-Fried"],
    ),
    2,
  );
});

// Codex P2 regression test — case/whitespace variants of the SAME entity
// must NOT inflate overlap past the threshold.
test("P3-5 countEntityOverlap: duplicates on cluster side count as one (Codex P2 regression)", () => {
  // Three case variants of "Asim Munir" plus one other; story has just
  // "Asim Munir". Pre-fix: filter counted 3 hits → overlap = 3 → false
  // ≥ 2 merge. Post-fix: dedupe → 1 unique shared → overlap = 1.
  const overlap = countEntityOverlap(
    ["Asim Munir", "asim munir", "ASIM MUNIR ", "Donald Trump"],
    ["Asim Munir"],
  );
  assert.equal(overlap, 1, "case/whitespace variants must collapse to one shared entity");
});

test("P3-5 countEntityOverlap: duplicates on story side also collapse", () => {
  const overlap = countEntityOverlap(
    ["Asim Munir"],
    ["Asim Munir", "asim munir", "ASIM MUNIR"],
  );
  assert.equal(overlap, 1);
});

test("P3-5 countEntityOverlap: empty / whitespace tokens drop, do not inflate", () => {
  const overlap = countEntityOverlap(
    ["Asim Munir", "", "  ", null, "Donald Trump"],
    ["Asim Munir", "", "Donald Trump", "  "],
  );
  assert.equal(overlap, 2);
});

test("P3-5 countEntityOverlap: empty / null inputs are safe", () => {
  assert.equal(countEntityOverlap([], []), 0);
  assert.equal(countEntityOverlap(null, ["x"]), 0);
  assert.equal(countEntityOverlap(["x"], null), 0);
});

// ── tolerantEntityOverlap (Starmer 3-way dup fix) ────────────────────────────

test("tolerantEntityOverlap: title-prefix variant of a name still aligns", () => {
  // Cluster extractor kept the office title; the LLM story did not. Exact
  // overlap would miss "keir starmer"; tolerant whole-word containment catches it.
  const { overlap, specificShared } = tolerantEntityOverlap(
    ["prime minister keir starmer", "labour"],
    ["Keir Starmer", "Labour Party"],
  );
  assert.equal(overlap, 2);
  assert.equal(specificShared, 2, "both shared tokens are story-specific named entities");
});

test("tolerantEntityOverlap: qualifier variant aligns (labour ↔ labour party)", () => {
  const { overlap } = tolerantEntityOverlap(["labour"], ["Labour Party"]);
  assert.equal(overlap, 1);
});

test("tolerantEntityOverlap: cross-category guard — one proper name + broad region is NOT enough", () => {
  // Two unrelated Trump stories sharing only "trump" + "us". overlap is 2 but
  // "us" is a BROAD region, so specificShared is 1 → cross-category merge rejected.
  const { overlap, specificShared } = tolerantEntityOverlap(
    ["donald trump", "us", "tariffs"],
    ["Donald Trump", "US", "NATO summit"],
  );
  assert.equal(overlap, 2, "trump + us both align");
  assert.equal(specificShared, 1, "only trump is a specific named entity; us is broad");
});

test("tolerantEntityOverlap: whole-word safety — substrings do not align", () => {
  const { overlap } = tolerantEntityOverlap(["art"], ["smart"]);
  assert.equal(overlap, 0, "'art' must not be treated as contained in 'smart'");
});

test("tolerantEntityOverlap: duplicate/case variants collapse, empties drop", () => {
  const { overlap } = tolerantEntityOverlap(
    ["Keir Starmer", "keir starmer", "", null],
    ["Keir Starmer", "  "],
  );
  assert.equal(overlap, 1);
});

test("tolerantEntityOverlap: null inputs are safe", () => {
  assert.deepEqual(tolerantEntityOverlap(null, ["x"]), { overlap: 0, specificShared: 0 });
  assert.deepEqual(tolerantEntityOverlap([], []), { overlap: 0, specificShared: 0 });
});

// ── P2-2: pickRelatedStories ─────────────────────────────────────────────────

test("P2-2 pickRelatedStories: ranks by overlap desc, returns ≤ 3", () => {
  const current = ["Sam Bankman-Fried", "FTX", "Department of Justice", "Lewis Kaplan"];
  const candidates = [
    // 4 overlap — strongest match
    { id: 50, headline: "FTX founder convicted on seven counts",  published_at: "2026-01-15T00:00:00Z", primary_entities: ["Sam Bankman-Fried", "FTX", "Department of Justice", "Lewis Kaplan"] },
    // 2 overlap — borderline
    { id: 51, headline: "FTX bankruptcy claims update",            published_at: "2026-02-01T00:00:00Z", primary_entities: ["FTX", "Department of Justice", "Some Other Person"] },
    // 1 overlap — below threshold, must be excluded
    { id: 52, headline: "Crypto market overview",                   published_at: "2026-03-01T00:00:00Z", primary_entities: ["FTX", "Coinbase", "Binance"] },
    // 3 overlap — middle
    { id: 53, headline: "DOJ charges new defendant in fraud case", published_at: "2026-02-20T00:00:00Z", primary_entities: ["Sam Bankman-Fried", "Department of Justice", "Lewis Kaplan", "OtherFigure"] },
  ];
  const result = pickRelatedStories(current, candidates);
  assert.equal(result.length, 3, "max 3 even when 4 candidates");
  assert.equal(result[0].id, 50, "highest overlap (4) leads");
  assert.equal(result[1].id, 53, "next highest (3) follows");
  assert.equal(result[2].id, 51, "lowest passing (2) last");
  // Stripped of internal _overlap field, only id/headline/date exposed.
  for (const r of result) {
    assert.deepEqual(Object.keys(r).sort(), ["date", "headline", "id"]);
  }
});

test("P2-2 pickRelatedStories: requires minimum overlap (default 2)", () => {
  const current = ["A", "B"];
  const candidates = [
    { id: 1, headline: "match A only", published_at: "2026-01-01T00:00:00Z", primary_entities: ["A"] },
    { id: 2, headline: "match B only", published_at: "2026-01-01T00:00:00Z", primary_entities: ["B"] },
  ];
  assert.deepEqual(pickRelatedStories(current, candidates), [],
    "single-entity overlap must not qualify");
});

test("P2-2 pickRelatedStories: tie-break by recency desc", () => {
  const current = ["Trump", "Iran"];
  const candidates = [
    { id: 1, headline: "older", published_at: "2026-01-01T00:00:00Z", primary_entities: ["Trump", "Iran"] },
    { id: 2, headline: "newer", published_at: "2026-04-01T00:00:00Z", primary_entities: ["Trump", "Iran"] },
    { id: 3, headline: "middle", published_at: "2026-02-15T00:00:00Z", primary_entities: ["Trump", "Iran"] },
  ];
  const result = pickRelatedStories(current, candidates);
  assert.equal(result[0].id, 2, "newest wins tie");
  assert.equal(result[1].id, 3);
  assert.equal(result[2].id, 1);
});

test("P2-2 pickRelatedStories: case-insensitive overlap (uses countEntityOverlap)", () => {
  // Mixed case across current and candidate — same entities, different
  // proper-cased forms (clean) vs lowercased (dirty cluster).
  const current = ["Donald Trump", "Iran", "United States"];
  const candidates = [
    { id: 1, headline: "earlier", published_at: "2026-01-01Z", primary_entities: ["donald trump", "iran"] },
  ];
  const result = pickRelatedStories(current, candidates);
  assert.equal(result.length, 1, "case-mixed entities must still match");
});

test("P2-2 pickRelatedStories: empty / null candidates", () => {
  assert.deepEqual(pickRelatedStories(["A", "B"], null), []);
  assert.deepEqual(pickRelatedStories(["A", "B"], []), []);
  assert.deepEqual(pickRelatedStories(["A", "B"], undefined), []);
});

test("P2-2 pickRelatedStories: skips candidates without id", () => {
  const candidates = [
    { headline: "no id",  published_at: "2026-01-01Z", primary_entities: ["A", "B"] },
    { id: 5, headline: "with id", published_at: "2026-01-02Z", primary_entities: ["A", "B"] },
  ];
  const result = pickRelatedStories(["A", "B", "C"], candidates);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 5);
});

test("P2-2 pickRelatedStories: respects custom cap and minOverlap", () => {
  const current = ["A", "B", "C", "D", "E"];
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, headline: `c${i}`, published_at: "2026-01-01Z",
    primary_entities: ["A", "B", "C", "D", "E"],
  }));
  // cap=2 → only 2 results.
  assert.equal(pickRelatedStories(current, candidates, { cap: 2 }).length, 2);
  // minOverlap=10 (impossible) → empty.
  assert.equal(pickRelatedStories(current, candidates, { minOverlap: 10 }).length, 0);
});

// ── P2-2 relatedStoryCutoff (Codex P1 fix on PR #82) ─────────────────────────

test("P2-2 relatedStoryCutoff: anchored to published_at, not Date.now()", () => {
  // Codex P1 regression — historical re-synth case. Anchor in 2023.
  // Pre-fix: cutoff = Date.now() - 90d (a 2026 timestamp), the supabase
  // query becomes published_at >= 2026 AND published_at < 2023 → empty.
  const anchor = "2023-06-15T00:00:00.000Z";
  const cutoff = relatedStoryCutoff(anchor, 90);
  // Cutoff must be 90 days BEFORE the anchor, not before today.
  const expected = new Date(Date.parse(anchor) - 90 * 86400 * 1000).toISOString();
  assert.equal(cutoff, expected);
  // And the cutoff must be strictly before the anchor — sanity guard.
  assert.ok(cutoff < anchor, "cutoff must precede anchor");
});

test("P2-2 relatedStoryCutoff: respects custom lookback window", () => {
  const anchor = "2026-04-01T00:00:00.000Z";
  const c30 = relatedStoryCutoff(anchor, 30);
  const c180 = relatedStoryCutoff(anchor, 180);
  assert.equal(c30,  new Date(Date.parse(anchor) - 30  * 86400 * 1000).toISOString());
  assert.equal(c180, new Date(Date.parse(anchor) - 180 * 86400 * 1000).toISOString());
  assert.ok(c180 < c30, "longer lookback yields earlier cutoff");
});

test("P2-2 relatedStoryCutoff: missing anchor falls back to now (defensive)", () => {
  const before = Date.now();
  const cutoff = relatedStoryCutoff(undefined, 90);
  const after = Date.now();
  // Cutoff is now − 90d ± a few ms.
  const cutoffMs = Date.parse(cutoff);
  const expectedMin = before - 90 * 86400 * 1000;
  const expectedMax = after - 90 * 86400 * 1000;
  assert.ok(cutoffMs >= expectedMin && cutoffMs <= expectedMax,
    `fallback cutoff ${cutoff} must be near now-90d`);
});

test("P2-2 relatedStoryCutoff: invalid anchor string falls back to now", () => {
  const before = Date.now();
  const cutoff = relatedStoryCutoff("not-a-date", 90);
  const cutoffMs = Date.parse(cutoff);
  // Should be roughly now − 90d, not NaN.
  assert.ok(Number.isFinite(cutoffMs));
  assert.ok(cutoffMs >= before - 90 * 86400 * 1000 - 1000, "invalid input must not poison the cutoff");
});

test("P3-5 cleanPrimaryEntities: enriched-only mode ignores cluster fallback even when populated", () => {
  // When enrichment succeeded, cluster fallback is not used at all —
  // proves the synth-time clean replaces, not augments.
  const dirty = ["completely irrelevant", "noise tokens"];
  const enriched = [{ name: "Clean Name", type: "person" }];
  assert.deepEqual(cleanPrimaryEntities(enriched, dirty), ["Clean Name"]);
});
