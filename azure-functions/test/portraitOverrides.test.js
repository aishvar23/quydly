#!/usr/bin/env node
// Unit tests for azure-functions/lib/portraitOverrides.js (P2-5).
//
// Usage: node --test test/portraitOverrides.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normaliseOverrideKey,
  lookupPortraitOverrides,
} from "../lib/portraitOverrides.js";

// ── normaliseOverrideKey ─────────────────────────────────────────────────────

test("P2-5 normaliseOverrideKey: lowercase + collapse whitespace + trim", () => {
  assert.equal(normaliseOverrideKey("Donald Trump"),       "donald trump");
  assert.equal(normaliseOverrideKey("  donald  trump  "),  "donald trump");
  assert.equal(normaliseOverrideKey("DONALD TRUMP"),       "donald trump");
  assert.equal(normaliseOverrideKey("Donald\tTrump"),      "donald trump");
});

test("P2-5 normaliseOverrideKey: empty / non-string returns ''", () => {
  assert.equal(normaliseOverrideKey(""), "");
  assert.equal(normaliseOverrideKey(null), "");
  assert.equal(normaliseOverrideKey(undefined), "");
  assert.equal(normaliseOverrideKey(42), "");
});

// ── lookupPortraitOverrides ──────────────────────────────────────────────────

// Stub supabase that mimics the from(...).select(...).in(...) chain.
function makeStubSupabase(rows) {
  return {
    from() {
      return {
        select() {
          return {
            in(_col, _vals) {
              return { data: rows, error: null };
            },
          };
        },
      };
    },
  };
}

function makeFailingSupabase(error) {
  return {
    from() {
      return {
        select() {
          return {
            in() { return { data: null, error }; },
          };
        },
      };
    },
  };
}

test("P2-5 lookupPortraitOverrides: empty input returns empty Map", async () => {
  const map = await lookupPortraitOverrides(makeStubSupabase([]), []);
  assert.equal(map.size, 0);
});

test("P2-5 lookupPortraitOverrides: matches by case-insensitive key", async () => {
  const rows = [{
    entity_name_norm: "donald trump",
    display_name:     "Donald Trump",
    image_url:        "https://example.com/dt.jpg",
    thumbnail_url:    "https://example.com/dt-thumb.jpg",
    attribution:      "AP Photo",
    license:          "Editorial use",
  }];
  const map = await lookupPortraitOverrides(makeStubSupabase(rows), [
    "Donald Trump",
    "DONALD TRUMP",  // dup that normalises to the same key
    "Asim Munir",    // no match
  ]);
  // Both casings of Trump resolve to the same row.
  assert.ok(map.has("Donald Trump"));
  assert.ok(map.has("DONALD TRUMP"));
  assert.equal(map.get("Donald Trump").image_url, "https://example.com/dt.jpg");
  assert.equal(map.get("DONALD TRUMP").image_url, "https://example.com/dt.jpg");
  // Unmatched name absent.
  assert.equal(map.has("Asim Munir"), false);
});

test("P2-5 lookupPortraitOverrides: degrades to empty Map on supabase error", async () => {
  const map = await lookupPortraitOverrides(
    makeFailingSupabase({ message: "table not found" }),
    ["Donald Trump"],
  );
  assert.equal(map.size, 0,
    "lookup must NEVER fail synthesis — empty Map = no override available");
});

test("P2-5 lookupPortraitOverrides: degrades to empty Map on thrown exception", async () => {
  const broken = {
    from() {
      throw new Error("connection refused");
    },
  };
  const map = await lookupPortraitOverrides(broken, ["Donald Trump"]);
  assert.equal(map.size, 0);
});

test("P2-5 lookupPortraitOverrides: skips empty / whitespace-only names", async () => {
  // The "in()" clause receives only normalised non-empty keys; verify by
  // capturing the args.
  let capturedKeys = null;
  const supabase = {
    from() {
      return {
        select() {
          return {
            in(_col, vals) {
              capturedKeys = vals;
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };
  await lookupPortraitOverrides(supabase, ["Donald Trump", "", "  ", null, "Asim Munir"]);
  assert.deepEqual(capturedKeys.sort(), ["asim munir", "donald trump"],
    "empty / whitespace inputs must not appear in the IN clause");
});

test("P2-5 lookupPortraitOverrides: preserves original-name keys for caller convenience", async () => {
  // Caller passes "Donald Trump" — wants Map.get("Donald Trump") to work,
  // not Map.get("donald trump"). Internal normalisation is hidden.
  const rows = [{
    entity_name_norm: "donald trump",
    display_name:     "Donald J. Trump",
    image_url:        "https://x/dt.jpg",
    attribution:      "AP",
    license:          "Editorial use",
  }];
  const map = await lookupPortraitOverrides(makeStubSupabase(rows), ["Donald Trump"]);
  assert.ok(map.has("Donald Trump"));
  assert.equal(map.has("donald trump"), false, "internal normalised key must not leak as a Map key");
});
