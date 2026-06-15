#!/usr/bin/env node
// Unit tests for Instagram source-link derivation (attribution: §8.3).
//
// Usage: node --test test/social-sources.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { sourceLinksFor, appendSourceLinks } from "../lib/social/platforms/_sources.js";

const STORY = {
  id: 1,
  headline: "Nvidia unveils new AI chip",
  source_documents: [
    { id: "a", type: "article", issuer: "reuters.com", url: "https://reuters.com/tech/nvidia-chip" },
    { id: "b", type: "article", issuer: "bbc.com", url: "https://bbc.com/news/nvidia" },
    { id: "c", type: "article", issuer: "theverge.com", url: "https://theverge.com/nvidia" },
    { id: "d", type: "article", issuer: "cnbc.com", url: "https://cnbc.com/nvidia" },
  ],
};

// ── sourceLinksFor ───────────────────────────────────────────────────────────

test("sourceLinksFor: returns HTTPS source urls in persisted order, capped at 3", () => {
  assert.deepEqual(sourceLinksFor(STORY), [
    "https://reuters.com/tech/nvidia-chip",
    "https://bbc.com/news/nvidia",
    "https://theverge.com/nvidia",
  ]);
});

test("sourceLinksFor: respects a custom max", () => {
  assert.deepEqual(sourceLinksFor(STORY, { max: 1 }), ["https://reuters.com/tech/nvidia-chip"]);
});

test("sourceLinksFor: drops non-HTTPS, blank, and duplicate urls", () => {
  const story = {
    source_documents: [
      { url: "http://insecure.com/x" },      // http → dropped
      { url: "  " },                          // blank → dropped
      { url: null },                          // missing → dropped
      { url: "https://good.com/a" },
      { url: "https://GOOD.com/a" },          // case-insensitive dup → dropped
      { url: "https://good.com/b" },
    ],
  };
  assert.deepEqual(sourceLinksFor(story), ["https://good.com/a", "https://good.com/b"]);
});

test("sourceLinksFor: empty when no source_documents", () => {
  assert.deepEqual(sourceLinksFor({}), []);
  assert.deepEqual(sourceLinksFor({ source_documents: [] }), []);
  assert.deepEqual(sourceLinksFor(null), []);
});

// ── appendSourceLinks ────────────────────────────────────────────────────────

test("appendSourceLinks: appends a blank-line-separated Sources block", () => {
  const out = appendSourceLinks("Caption body. Visit quydly.com", STORY);
  assert.equal(
    out,
    "Caption body. Visit quydly.com\n\nSources:\nhttps://reuters.com/tech/nvidia-chip\nhttps://bbc.com/news/nvidia\nhttps://theverge.com/nvidia"
  );
});

test("appendSourceLinks: body preserved verbatim at the start", () => {
  const out = appendSourceLinks("Body text", STORY);
  assert.ok(out.startsWith("Body text\n\nSources:\n"));
});

test("appendSourceLinks: returns body unchanged when story has no usable urls", () => {
  assert.equal(appendSourceLinks("Body", { source_documents: [] }), "Body");
  assert.equal(appendSourceLinks("Body", { source_documents: [{ url: "http://no.com" }] }), "Body");
});

test("appendSourceLinks: stays within the IG 1500-char cap", () => {
  const out = appendSourceLinks("x".repeat(1490), STORY);
  assert.ok(out.length <= 1500, `length ${out.length} > 1500`);
});

test("appendSourceLinks: returns body unchanged when header + first url would not fit", () => {
  const body = "y".repeat(1500);
  assert.equal(appendSourceLinks(body, STORY), body);
});

test("appendSourceLinks: no leading separator when body is empty", () => {
  const out = appendSourceLinks("", STORY);
  assert.ok(out.startsWith("Sources:\n"));
});
