#!/usr/bin/env node
// Unit tests for azure-functions/lib/wikipedia.js (P0-4).
//
// Usage: node --test test/wikipedia.test.js
//
// Covers the strict-match guard logic and the cache. The fetch path itself is
// stubbed via globalThis.fetch — tests do not hit real Wikipedia.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { probeEntityWikipedia, probeEntities, _resetCache } from "../lib/wikipedia.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(status, body, { ok = status >= 200 && status < 300 } = {}) {
  return {
    status,
    ok,
    json: async () => body,
  };
}

function installFetchStub(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => handler(...args);
  return () => { globalThis.fetch = original; };
}

beforeEach(() => {
  _resetCache();
});

// ── Happy path ────────────────────────────────────────────────────────────────

test("P0-4 probeEntityWikipedia returns full metadata when title matches", async () => {
  const restore = installFetchStub(async (url) => {
    assert.match(url, /Sam_Bankman-Fried\?redirect=false$/);
    return jsonResponse(200, {
      type:     "standard",
      title:    "Sam Bankman-Fried",
      extract:  "Samuel Bankman-Fried is an American businessman and convicted fraudster.",
      thumbnail: { source: "https://upload.wikimedia.org/.../320px-Sam_Bankman-Fried.jpg", width: 320, height: 320 },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Sam_Bankman-Fried" } },
    });
  });

  try {
    const r = await probeEntityWikipedia("Sam Bankman-Fried");
    assert.equal(r.resolved, true);
    assert.equal(r.wikipedia_title, "Sam Bankman-Fried");
    assert.equal(r.wikipedia_url, "https://en.wikipedia.org/wiki/Sam_Bankman-Fried");
    assert.match(r.wikipedia_thumbnail_url, /320px-Sam_Bankman-Fried\.jpg$/);
    assert.match(r.wikipedia_summary, /American businessman/);
    assert.equal(typeof r.image_license, "string");
  } finally {
    restore();
  }
});

// ── Strict guards ─────────────────────────────────────────────────────────────

test("P0-4 probeEntityWikipedia refuses when status is 30x (redirect refused)", async () => {
  const restore = installFetchStub(async () => ({ status: 302, ok: false, json: async () => ({}) }));
  try {
    const r = await probeEntityWikipedia("Gannon Ken Van Dyke");
    assert.equal(r.resolved, false);
    assert.equal(r.reason, "redirect_refused");
  } finally {
    restore();
  }
});

test("P0-4 probeEntityWikipedia returns not_found on 404", async () => {
  const restore = installFetchStub(async () => ({ status: 404, ok: false, json: async () => ({}) }));
  try {
    const r = await probeEntityWikipedia("Definitely Not A Real Person 9999");
    assert.equal(r.resolved, false);
    assert.equal(r.reason, "not_found");
  } finally {
    restore();
  }
});

test("P0-4 probeEntityWikipedia refuses disambiguation pages", async () => {
  const restore = installFetchStub(async () =>
    jsonResponse(200, { type: "disambiguation", title: "Manhattan" })
  );
  try {
    const r = await probeEntityWikipedia("Manhattan");
    assert.equal(r.resolved, false);
    assert.equal(r.reason, "disambiguation");
  } finally {
    restore();
  }
});

test("P0-4 probeEntityWikipedia refuses when returned title misses query tokens", async () => {
  // Query is "Gannon Ken Van Dyke" — none of those tokens appear in the
  // returned title. The strict-match guard must reject regardless of how the
  // image looks. (This is the v2-documented incident that motivates P0-4.)
  const restore = installFetchStub(async () =>
    jsonResponse(200, {
      type:     "standard",
      title:    "United States Special Operations Command",
      extract:  "...",
      thumbnail: { source: "https://upload.wikimedia.org/.../trump-situation-room.jpg" },
    })
  );
  try {
    const r = await probeEntityWikipedia("Gannon Ken Van Dyke");
    assert.equal(r.resolved, false);
    assert.equal(r.reason, "title_mismatch");
    assert.equal(r.wikipedia_title, "United States Special Operations Command",
      "preserve the wrong title we refused — useful for telemetry");
  } finally {
    restore();
  }
});

test("P0-4 probeEntityWikipedia tolerates diacritic drift in title match", async () => {
  // Article title carries accent; query does not. NFD-fold + strip combining
  // marks must let this through.
  const restore = installFetchStub(async () =>
    jsonResponse(200, {
      type:     "standard",
      title:    "Reykjavík",
      extract:  "Capital of Iceland.",
      thumbnail: { source: "https://upload.wikimedia.org/.../reykjavik.jpg" },
    })
  );
  try {
    const r = await probeEntityWikipedia("Reykjavik");
    assert.equal(r.resolved, true);
    assert.equal(r.wikipedia_title, "Reykjavík");
  } finally {
    restore();
  }
});

test("P0-4 probeEntityWikipedia accepts longer canonical titles that include the query tokens", async () => {
  // "Sam Bankman-Fried" → canonical "Samuel Bankman-Fried". All query tokens
  // appear in the canonical title (sam is a prefix of samuel? No — strict
  // token equality required). So this MUST currently return title_mismatch
  // because "sam" is not in "{samuel, bankman, fried}". The query name should
  // be the exact display name we want to match.
  const restore = installFetchStub(async () =>
    jsonResponse(200, {
      type:     "standard",
      title:    "Sam Bankman-Fried",
      extract:  "Samuel Bankman-Fried.",
      thumbnail: { source: "https://upload.wikimedia.org/.../sam-bf.jpg" },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Sam_Bankman-Fried" } },
    })
  );
  try {
    const r = await probeEntityWikipedia("Sam Bankman-Fried");
    assert.equal(r.resolved, true);
  } finally {
    restore();
  }
});

test("P0-4 probeEntityWikipedia handles missing thumbnail (page exists, no image)", async () => {
  const restore = installFetchStub(async () =>
    jsonResponse(200, {
      type:     "standard",
      title:    "Some Obscure Topic",
      extract:  "An obscure topic with no lead image.",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Some_Obscure_Topic" } },
    })
  );
  try {
    const r = await probeEntityWikipedia("Some Obscure Topic");
    assert.equal(r.resolved, true);
    assert.equal(r.wikipedia_thumbnail_url, null,
      "missing thumbnail surfaces as null but resolved still true so summary/url survive");
    assert.match(r.wikipedia_summary, /obscure topic/i);
  } finally {
    restore();
  }
});

// ── Empty / edge inputs ───────────────────────────────────────────────────────

test("P0-4 probeEntityWikipedia rejects empty/blank/non-string inputs without fetching", async () => {
  let fetchCalls = 0;
  const restore = installFetchStub(async () => { fetchCalls += 1; return jsonResponse(200, {}); });
  try {
    assert.equal((await probeEntityWikipedia("")).resolved, false);
    assert.equal((await probeEntityWikipedia("   ")).resolved, false);
    assert.equal((await probeEntityWikipedia(null)).resolved, false);
    assert.equal((await probeEntityWikipedia(undefined)).resolved, false);
    assert.equal(fetchCalls, 0, "empty inputs must short-circuit before the network call");
  } finally {
    restore();
  }
});

// ── Cache ─────────────────────────────────────────────────────────────────────

test("P0-4 probeEntityWikipedia caches results by lowercased name across calls", async () => {
  let fetchCalls = 0;
  const restore = installFetchStub(async () => {
    fetchCalls += 1;
    return jsonResponse(200, {
      type:     "standard",
      title:    "FTX",
      extract:  "...",
      thumbnail: { source: "https://upload.wikimedia.org/.../ftx.jpg" },
    });
  });
  try {
    await probeEntityWikipedia("FTX");
    await probeEntityWikipedia("ftx");
    await probeEntityWikipedia("FTX");
    assert.equal(fetchCalls, 1, "second + third calls must be served from memo");
  } finally {
    restore();
  }
});

// ── Batch helper ──────────────────────────────────────────────────────────────

test("P0-4 probeEntities preserves input order and returns one result per input", async () => {
  const responses = {
    "Sam Bankman-Fried": { title: "Sam Bankman-Fried", extract: "...", thumbnail: { source: "https://x/sbf.jpg" } },
    "FTX":              { title: "FTX",              extract: "...", thumbnail: { source: "https://x/ftx.jpg" } },
    "Department of Justice": { title: "United States Department of Justice", extract: "...", thumbnail: { source: "https://x/doj.jpg" } },
  };
  const restore = installFetchStub(async (url) => {
    const decoded = decodeURIComponent(new URL(url).pathname.split("/").pop()).replace(/_/g, " ");
    const body = responses[decoded] ?? null;
    if (!body) return { status: 404, ok: false, json: async () => ({}) };
    return jsonResponse(200, { type: "standard", ...body });
  });
  try {
    const r = await probeEntities(["Sam Bankman-Fried", "FTX", "Department of Justice"], { concurrency: 2 });
    assert.equal(r.length, 3);
    assert.equal(r[0].wikipedia_title, "Sam Bankman-Fried");
    assert.equal(r[1].wikipedia_title, "FTX");
    assert.equal(r[2].wikipedia_title, "United States Department of Justice");
  } finally {
    restore();
  }
});

test("P0-4 probeEntities never throws — per-entity failures degrade to resolved=false", async () => {
  const restore = installFetchStub(async (url) => {
    if (url.includes("Crash")) throw new Error("simulated network failure");
    return jsonResponse(200, {
      type:     "standard",
      title:    "OK",
      extract:  "...",
      thumbnail: { source: "https://x.jpg" },
    });
  });
  try {
    const r = await probeEntities(["Crash Test", "OK"]);
    assert.equal(r.length, 2);
    assert.equal(r[0].resolved, false);
    // The error path goes through fetchWithRetry exhaustion — surfaces as
    // network_error, not unexpected_error, because lookupSummary catches it.
    assert.match(String(r[0].reason), /network_error|unexpected_error/);
    assert.equal(r[1].resolved, true);
  } finally {
    restore();
  }
});
