#!/usr/bin/env node
// Unit tests for azure-functions/lib/sourceDiversity.js (P1-8).
//
// Usage: node --test test/sourceDiversity.test.js
//
// Pure-function tests — no I/O. The synthesizer feeds this helper the same
// articles it snapshots into source_documents, so the score is consistent
// with what EvidenceShelf will see.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeSourceDiversity,
  rootDomain,
  isWire,
  WIRE_DOMAINS,
} from "../lib/sourceDiversity.js";

// ── rootDomain ────────────────────────────────────────────────────────────────

test("rootDomain: trims well-known noise prefixes", () => {
  assert.equal(rootDomain("www.reuters.com"),    "reuters.com");
  assert.equal(rootDomain("edition.cnn.com"),    "cnn.com");
  assert.equal(rootDomain("amp.theguardian.com"),"theguardian.com");
  assert.equal(rootDomain("in.reuters.com"),     "reuters.com");
});

test("rootDomain: leaves unknown subdomains intact", () => {
  // We only strip a tight whitelist; arbitrary subdomains stay so we don't
  // incorrectly merge unrelated outlets.
  assert.equal(rootDomain("opinion.nytimes.com"), "opinion.nytimes.com");
  assert.equal(rootDomain("blogs.economist.com"), "blogs.economist.com");
});

test("rootDomain: returns null for empty / non-string input", () => {
  assert.equal(rootDomain(null),       null);
  assert.equal(rootDomain(undefined),  null);
  assert.equal(rootDomain(""),         null);
  assert.equal(rootDomain("   "),      null);
  assert.equal(rootDomain(42),         null);
});

// ── isWire ────────────────────────────────────────────────────────────────────

test("isWire: detects wires after trimming subdomains", () => {
  assert.equal(isWire("reuters.com"),     true);
  assert.equal(isWire("www.reuters.com"), true);
  assert.equal(isWire("in.reuters.com"),  true);
  assert.equal(isWire("apnews.com"),      true);
});

test("isWire: rejects non-wires", () => {
  assert.equal(isWire("nytimes.com"),  false);
  assert.equal(isWire("bbc.co.uk"),    false);
  assert.equal(isWire("rappler.com"),  false);
  assert.equal(isWire(null),           false);
});

test("isWire: WIRE_DOMAINS is a non-empty Set so callers can iterate", () => {
  assert.ok(WIRE_DOMAINS instanceof Set);
  assert.ok(WIRE_DOMAINS.size >= 5);
});

// ── computeSourceDiversity — happy path ──────────────────────────────────────

test("diversity: empty input scores 0 / single", () => {
  const r = computeSourceDiversity([]);
  assert.equal(r.score, 0);
  assert.equal(r.label, "single");
  assert.equal(r.domain_count, 0);
});

test("diversity: missing domain field is ignored cleanly", () => {
  const r = computeSourceDiversity([{ domain: null }, { domain: "" }, {}]);
  assert.equal(r.domain_count, 0);
  assert.equal(r.score, 0);
});

test("diversity: single non-wire domain → 0.6 * 1/5 + 0.4 * 1/1 = 0.520, narrow", () => {
  const r = computeSourceDiversity([{ domain: "nytimes.com" }]);
  assert.equal(r.domain_count, 1);
  assert.equal(r.wire_count, 0);
  assert.equal(r.non_wire_count, 1);
  assert.equal(r.score, 0.520);
  assert.equal(r.label, "narrow");
});

test("diversity: single wire-only pickup → 0.6 * 1/5 + 0.4 * 0 = 0.120, single", () => {
  // Worst case for editorial honesty — one wire, nothing else. Should
  // visibly bucket as "single" so EvidenceShelf can call it out.
  const r = computeSourceDiversity([{ domain: "reuters.com" }]);
  assert.equal(r.domain_count, 1);
  assert.equal(r.wire_count, 1);
  assert.equal(r.score, 0.120);
  assert.equal(r.label, "single");
});

test("diversity: three wire re-prints score lower than one wire + one independent", () => {
  // Three Reuters re-prints ≠ three independent sources. Test guards
  // against the regression where source_count was trusted blindly.
  const wirePile = computeSourceDiversity([
    { domain: "www.reuters.com" },
    { domain: "in.reuters.com"  },     // dedupes to reuters.com
    { domain: "apnews.com"      },
  ]);
  const mixedPair = computeSourceDiversity([
    { domain: "reuters.com" },
    { domain: "bbc.co.uk"   },
  ]);
  // wirePile is 2 distinct (reuters + ap) both wires:
  //   0.6 * 2/5 + 0.4 * 0/2 = 0.240
  // mixedPair is 2 distinct (1 wire, 1 non-wire):
  //   0.6 * 2/5 + 0.4 * 1/2 = 0.440
  assert.ok(mixedPair.score > wirePile.score,
    `expected mixed ${mixedPair.score} > all-wire ${wirePile.score}`);
});

test("diversity: 5 distinct non-wire domains saturates the domain term", () => {
  // 0.6 * 5/5 + 0.4 * 5/5 = 1.0 → label "diverse".
  const r = computeSourceDiversity([
    { domain: "nytimes.com" },
    { domain: "bbc.co.uk" },
    { domain: "theguardian.com" },
    { domain: "ft.com" },
    { domain: "rappler.com" },
  ]);
  assert.equal(r.domain_count, 5);
  assert.equal(r.score, 1);
  assert.equal(r.label, "diverse");
});

test("diversity: above 5 distinct domains stays capped at 1.0 (no overflow)", () => {
  const r = computeSourceDiversity([
    { domain: "nytimes.com" },
    { domain: "bbc.co.uk" },
    { domain: "theguardian.com" },
    { domain: "ft.com" },
    { domain: "rappler.com" },
    { domain: "wsj.com" },
    { domain: "washingtonpost.com" },
  ]);
  assert.equal(r.domain_count, 7);
  assert.equal(r.score, 1);
});

test("diversity: duplicate domains (subdomain variants) are deduped, not double-counted", () => {
  // www.cnn.com and edition.cnn.com both root to cnn.com.
  const r = computeSourceDiversity([
    { domain: "www.cnn.com" },
    { domain: "edition.cnn.com" },
    { domain: "amp.cnn.com" },
  ]);
  assert.equal(r.domain_count, 1);
});
