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
  networkOf,
  WIRE_DOMAINS,
  SISTER_NETWORKS,
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

// Codex P2 review on PR #72: the strip must NOT collapse a bare domain
// like "news.com" into "com". We accept the strip only when at least one
// dot remains afterwards. The bare-domain case is regression-tested here
// for every prefix in the strip whitelist.
test("rootDomain: bare domains whose first label matches a noise prefix are preserved", () => {
  assert.equal(rootDomain("news.com"),    "news.com",
    "first-label-only matches must NOT strip — prevents collapsing into TLD");
  assert.equal(rootDomain("amp.com"),     "amp.com");
  assert.equal(rootDomain("mobile.com"),  "mobile.com");
  assert.equal(rootDomain("uk.co.uk"),    "co.uk",     // multi-label survives
    "deeper bare-shape input still strips when a registrable domain remains");
});

test("rootDomain: noise-prefixed multi-label bare domains still strip cleanly", () => {
  // Confirm the legitimate strip path didn't regress on the P2 fix.
  assert.equal(rootDomain("news.bbc.co.uk"), "bbc.co.uk");
  assert.equal(rootDomain("in.reuters.com"), "reuters.com");
  assert.equal(rootDomain("amp.theguardian.com"), "theguardian.com");
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

// ── networkOf + sister-network collapse ─────────────────────────────────────

test("networkOf: 9to5 cluster collapses to one network id", () => {
  assert.equal(networkOf("9to5google.com"), "9to5_network");
  assert.equal(networkOf("9to5mac.com"),    "9to5_network");
  assert.equal(networkOf("electrek.co"),    "9to5_network");
});

test("networkOf: vox / verge / motherboard collapse to their parents", () => {
  assert.equal(networkOf("vox.com"),               "vox_media");
  assert.equal(networkOf("theverge.com"),          "vox_media");
  assert.equal(networkOf("motherboard.vice.com"),  "vice_media");
  assert.equal(networkOf("vice.com"),              "vice_media");
});

test("networkOf: unknown domains pass through unchanged", () => {
  assert.equal(networkOf("nytimes.com"), "nytimes.com");
  assert.equal(networkOf("rappler.com"), "rappler.com");
  assert.equal(networkOf(null),           null);
});

test("SISTER_NETWORKS: at least the 9to5 cluster (story 215 incident) is registered", () => {
  // Defensive — keeps a regression guard against accidentally trimming
  // the network we have a documented incident for.
  assert.ok(SISTER_NETWORKS["9to5_network"] instanceof Set);
  assert.ok(SISTER_NETWORKS["9to5_network"].has("9to5google.com"));
  assert.ok(SISTER_NETWORKS["9to5_network"].has("9to5mac.com"));
});

// ── computeSourceDiversity — sister-network cap (story 215 shape) ───────────

test("diversity: 9to5 cluster (story 215 shape) caps label at 'narrow' regardless of score", () => {
  // Three 9to5google + one 9to5mac. Raw score reads 0.520 (1 distinct
  // root after sister-collapse... wait — domain_count is still 2 here
  // because 9to5google.com and 9to5mac.com are different roots. The cap
  // fires on network_count=1 even though domain_count says 2.
  const r = computeSourceDiversity([
    { domain: "9to5google.com" },
    { domain: "9to5google.com" },
    { domain: "9to5google.com" },
    { domain: "9to5mac.com"    },
  ]);
  assert.equal(r.domain_count,  2,           "domain_count uses raw roots");
  assert.equal(r.network_count, 1,           "9to5 cluster collapses to one network");
  assert.equal(r.label,         "narrow",    "label capped despite 2 distinct domains");
});

test("diversity: 5 distinct unrelated networks stays diverse (cap does not over-fire)", () => {
  // The cap should not affect stories with genuine cross-network coverage.
  const r = computeSourceDiversity([
    { domain: "nytimes.com" },
    { domain: "bbc.co.uk" },
    { domain: "theguardian.com" },
    { domain: "ft.com" },
    { domain: "rappler.com" },
  ]);
  assert.equal(r.network_count, 5);
  assert.equal(r.label, "diverse");
});

// ── computeSourceDiversity — author concentration ───────────────────────────

test("diversity: ≥75% of articles share one author caps label at 'narrow' (story 215 shape)", () => {
  // Story 215 incident: 4 articles by Justin Kahn at 9to5 sister sites.
  // Even setting sister-collapse aside, 3/4 by one author is single-
  // perspective.
  const r = computeSourceDiversity([
    { domain: "nytimes.com",      author: "Justin Kahn" },
    { domain: "washingtonpost.com", author: "Justin Kahn" },
    { domain: "bbc.co.uk",        author: "Justin Kahn" },
    { domain: "ft.com",           author: "Sarah Chen" },
  ]);
  // 4 distinct unrelated networks — would normally land "diverse". The
  // 0.75 author concentration caps it at "narrow".
  assert.equal(r.network_count,    4);
  assert.equal(r.top_author_share, 0.75);
  assert.equal(r.label,            "narrow");
});

test("diversity: single dominant author below 0.75 does not trigger the cap", () => {
  // 2/4 = 0.5 share. No cap.
  const r = computeSourceDiversity([
    { domain: "nytimes.com", author: "Justin Kahn" },
    { domain: "bbc.co.uk",   author: "Justin Kahn" },
    { domain: "ft.com",      author: "Sarah Chen" },
    { domain: "wsj.com",     author: "Maria Lopez" },
  ]);
  assert.equal(r.top_author_share, 0.5);
  assert.equal(r.label, "diverse");
});

test("diversity: missing author fields are ignored (cap fires only on present authors)", () => {
  // Two articles share an author; two have no author. Concentration is
  // computed against articles-with-author (2/2 = 1.0) — cap fires.
  const r = computeSourceDiversity([
    { domain: "nytimes.com", author: "Justin Kahn" },
    { domain: "bbc.co.uk",   author: "Justin Kahn" },
    { domain: "ft.com" },
    { domain: "wsj.com" },
  ]);
  assert.equal(r.top_author_share, 1.0);
  assert.equal(r.label, "narrow");
});

test("diversity: empty author strings do not pollute the share calculation", () => {
  // Whitespace-only authors must not count as a real byline.
  const r = computeSourceDiversity([
    { domain: "nytimes.com", author: "   " },
    { domain: "bbc.co.uk",   author: "" },
    { domain: "ft.com",      author: "Sarah Chen" },
  ]);
  assert.equal(r.top_author_share, 1.0);  // Only one real author present
});

// ── computeSourceDiversity — country count ──────────────────────────────────

test("diversity: country_count tracks distinct source_country values (story 181 shape)", () => {
  // Story 181: 6/6 articles source_country='in' on an India/Bangladesh
  // bilateral story. country_count=1 lets downstream rules detect the
  // single-perspective collapse.
  const r = computeSourceDiversity([
    { domain: "timesofindia.indiatimes.com", source_country: "in" },
    { domain: "thehindu.com",                source_country: "in" },
    { domain: "ndtv.com",                    source_country: "in" },
  ]);
  assert.equal(r.country_count, 1);
});

test("diversity: country_count counts distinct non-empty values, ignores blanks", () => {
  const r = computeSourceDiversity([
    { domain: "nytimes.com", source_country: "us" },
    { domain: "bbc.co.uk",   source_country: "gb" },
    { domain: "thehindu.com", source_country: "in" },
    { domain: "rappler.com", source_country: null },
    { domain: "ft.com",      source_country: "" },
  ]);
  assert.equal(r.country_count, 3);
});

// ── backward compatibility ──────────────────────────────────────────────────

test("diversity: pre-existing fields keep their shape (no breaking caller changes)", () => {
  const r = computeSourceDiversity([{ domain: "nytimes.com" }]);
  assert.ok(typeof r.score === "number");
  assert.ok(typeof r.label === "string");
  assert.ok(typeof r.domain_count === "number");
  assert.ok(typeof r.wire_count === "number");
  assert.ok(typeof r.non_wire_count === "number");
  // New informational fields are additive.
  assert.ok(typeof r.network_count === "number");
  assert.ok(typeof r.country_count === "number");
  assert.ok(typeof r.top_author_share === "number");
});
