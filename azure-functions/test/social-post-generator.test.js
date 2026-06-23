#!/usr/bin/env node
// Unit tests for Phase 2 draft generation.
//
// Usage: node --test test/social-post-generator.test.js
//
// Covers:
//   2.1 platform formatters (templates + length rules)
//   2.2 generator orchestrator (one draft/platform, candidate -> POST_GENERATED)
//   2.3 text validation (§10.4)
//   2.6 idempotent inserts
//   2.7 Instagram flagged as requiring media

import { test } from "node:test";
import assert from "node:assert/strict";

import * as x from "../lib/social/platforms/x.js";
import * as facebook from "../lib/social/platforms/facebook.js";
import * as instagram from "../lib/social/platforms/instagram.js";
import { validatePost, validateCoverHook } from "../lib/social/social-validation.js";
import { generateSocialPosts } from "../lib/social/social-post-generator.js";
import { weightedLength } from "../lib/social/platforms/x.js";

// ── X URL-weighting (regression: live tweet dropped the quydly.com CTA) ───────

test("weightedLength: counts each URL as 23 chars", () => {
  assert.equal(weightedLength("hello"), 5);
  // "see quydly.com" → "see " (4) + 23 = 27
  assert.equal(weightedLength("see quydly.com"), 27);
  assert.equal(weightedLength("a https://example.com/very/long/path b"), "a  b".length + 23);
});

test("x.format: within weighted 280, brand CTA present, NO url", () => {
  // A long story that previously pushed content past X's weighted 280.
  const longStory = {
    id: 7,
    headline: "Argentina Names Squad for 2026 World Cup with Messi Making Record Sixth Appearance",
    summary: "Argentina named its squad.",
    key_points: [
      "Messi will make a record sixth FIFA World Cup appearance at age 38",
      "Argentina retained 17 players from their 2022 World Cup-winning squad",
    ],
  };
  const out = x.format(longStory, "global");
  assert.match(out.text, /in our bio/i, "bio CTA must be present");
  assert.match(out.text, /reply/i, "reply hook must be present");
  assert.ok(!/https?:\/\/|quydly\.com/i.test(out.text), "X post must carry no URL");
  assert.equal(out.linkUrl, null);
  assert.ok(weightedLength(out.text) <= 280, `weighted ${weightedLength(out.text)} > 280`);
});

const STORY = {
  id: 101,
  headline: "City unveils new electric bus fleet",
  summary: "The transit authority launched a new electric bus line today. Officials said it will cut emissions on the busiest downtown route.",
  category_id: "tech",
  key_points: [
    "The new line runs on the downtown corridor",
    "Officials expect lower emissions",
    "Service begins next month",
  ],
  source_count: 4,
  story_score: 42,
  confidence_score: 8,
};

// ── Formatters ───────────────────────────────────────────────────────────────

test("x.format: within 280 chars, bio CTA, no media", () => {
  const out = x.format(STORY, "global");
  assert.ok(out.text.length <= 280, `len ${out.text.length}`);
  assert.match(out.text, /in our bio/i);
  assert.equal(out.requiresMedia, false);
  assert.equal(out.mediaUrl, null);
});

test("facebook.format: within 900 chars, has CTA + numbered points", () => {
  const out = facebook.format(STORY, "global");
  assert.ok(out.text.length <= 900);
  assert.match(out.text, /Quydly news quiz/i);
  assert.match(out.text, /1\./);
});

test("instagram.format: within 1500, requiresMedia true, no media url yet", () => {
  const out = instagram.format(STORY, "global");
  assert.ok(out.text.length <= 1500);
  assert.match(out.text, /quydly/i);
  assert.equal(out.requiresMedia, true);
  assert.equal(out.mediaUrl, null);
});

// ── Validation (§10.4) ───────────────────────────────────────────────────────

test("validatePost: deterministic drafts pass", () => {
  for (const p of [x, facebook, instagram]) {
    const out = p.format(STORY, "global");
    const v = validatePost({ platform: p.PLATFORM, text: out.text, story: STORY, constraints: p.CONSTRAINTS });
    assert.ok(v.valid, `${p.PLATFORM}: ${v.errors.join(", ")}`);
  }
});

test("validatePost: rejects missing CTA, breaking, unsupported number, over-length", () => {
  const base = { story: STORY, constraints: x.CONSTRAINTS, platform: "x" };
  assert.equal(validatePost({ ...base, text: "Some news with no call to action" }).valid, false);
  assert.equal(validatePost({ ...base, text: "BREAKING: thing happened quydly.com" }).valid, false);
  assert.equal(validatePost({ ...base, text: "City spent 999 million dollars quydly.com" }).valid, false);
  assert.equal(validatePost({ ...base, text: "x".repeat(300) + " quydly.com" }).valid, false);
});

test("validatePost: allows numbers present in the story facts", () => {
  // "next month" has no number; add a story number and ensure it passes.
  const story = { ...STORY, summary: STORY.summary + " The route serves 12 stops." };
  const v = validatePost({ platform: "facebook", story, constraints: facebook.CONSTRAINTS,
    text: "Route serves 12 stops. Try the Quydly news quiz: quydly.com" });
  assert.ok(v.valid, v.errors.join(", "));
});

// ── Cover-hook validation (the hook is rendered into the cover IMAGE, so it is
//    guarded here — it never passes through validatePost) ──────────────────────

test("validateCoverHook: a clean, story-grounded hook passes", () => {
  const story = { ...STORY, summary: STORY.summary + " The plan adds 12 new routes." };
  const v = validateCoverHook({ hook: "City just added 12 new bus routes", story });
  assert.ok(v.valid, v.errors.join(", "));
});

test("validateCoverHook: rejects clickbait, unsupported number, overlong, and empty", () => {
  assert.equal(validateCoverHook({ hook: "You won't believe what the city just did", story: STORY }).valid, false);
  assert.equal(validateCoverHook({ hook: "The mayor finally breaks his silence on buses", story: STORY }).valid, false);
  assert.equal(validateCoverHook({ hook: "City spent 999 billion on a bus", story: STORY }).valid, false); // 999 not in story
  assert.equal(validateCoverHook({ hook: Array(16).fill("word").join(" "), story: STORY }).valid, false);   // >14 words
  assert.equal(validateCoverHook({ hook: "", story: STORY }).valid, false);
});

function makeSupabaseMock({ candidate, story, existingByPlatform = {} }) {
  const inserted = [];
  const candidateUpdates = [];

  function from(table) {
    const q = { table, _filters: {}, _op: null, _payload: null };
    q.select = () => q;
    q.eq = (k, v) => { q._filters[k] = v; return q; };
    q.upsert = (payload) => { q._op = "upsert"; q._payload = payload; return q; };
    q.update = (payload) => { q._op = "update"; q._payload = payload; return q; };
    q.maybeSingle = () => resolve(q);
    q.then = (res, rej) => resolve(q).then(res, rej); // awaited update().eq()
    return q;
  }

  async function resolve(q) {
    if (q.table === "social_publication_candidates") {
      if (q._op === "update") { candidateUpdates.push(q._payload); return { data: null, error: null }; }
      return { data: candidate, error: null };
    }
    if (q.table === "stories") return { data: story, error: null };
    if (q.table === "social_posts") {
      if (q._op === "upsert") {
        const rec = { id: `post-${inserted.length + 1}`, ...q._payload };
        inserted.push(rec);
        return { data: { id: rec.id }, error: null };
      }
      return { data: existingByPlatform[q._filters.platform] || null, error: null };
    }
    return { data: null, error: null };
  }

  return { client: { from }, inserted, candidateUpdates };
}

const CANDIDATE = { id: "cand-1", story_id: 101, audience_geo: "global", status: "PENDING" };

test("generateSocialPosts: creates one PENDING_REVIEW draft per platform", async () => {
  const mock = makeSupabaseMock({ candidate: CANDIDATE, story: STORY });
  const res = await generateSocialPosts({ supabase: mock.client, candidateId: "cand-1" });

  assert.equal(res.created, 3);
  assert.equal(res.skipped, 0);
  assert.deepEqual(mock.inserted.map((p) => p.platform).sort(), ["facebook", "instagram", "x"]);
  assert.ok(mock.inserted.every((p) => p.status === "PENDING_REVIEW"));
  // Instagram has no media url (flagged as requiring an asset before publish).
  assert.equal(mock.inserted.find((p) => p.platform === "instagram").media_url, null);
  // Candidate advanced to POST_GENERATED.
  assert.equal(mock.candidateUpdates.at(-1).status, "POST_GENERATED");
});

test("generateSocialPosts: idempotent when posts already exist", async () => {
  const existingByPlatform = { x: { id: "p" }, facebook: { id: "p" }, instagram: { id: "p" } };
  const mock = makeSupabaseMock({ candidate: CANDIDATE, story: STORY, existingByPlatform });
  const res = await generateSocialPosts({ supabase: mock.client, candidateId: "cand-1" });

  assert.equal(res.created, 0);
  assert.equal(res.skipped, 3);
  assert.equal(mock.inserted.length, 0);
});
