#!/usr/bin/env node
// Unit tests for Phase 5 — limited auto-publish (gated, off by default).
//
// Usage: node --test test/social-autopublish.test.js
//
// Covers:
//   5.1 evaluateAutoApproval (§10.3 conditions) + countSourceDomains
//   5.2 decideCandidateStatus respects enable flag + per-day budget
//   5.3 sensitive-category hard block (never auto-approved)
//   5.4 generator auto status path (AUTO_APPROVED → X/FB APPROVED, IG review)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAutoApproval,
  countSourceDomains,
  SENSITIVITY,
  classifySensitivity,
} from "../lib/social/social-safety.js";
import { decideCandidateStatus } from "../lib/social/social-candidates.js";
import { generateSocialPosts } from "../lib/social/social-post-generator.js";
import FLAGS from "../lib/flags.js";

const AUTO = FLAGS.social.autoApprove; // {minConfidence:8,minStoryScore:30,minUniqueDomains:3,maxPerDay:3,safeCategories}

// A safe, high-quality, LOW-sensitivity story that clears the gate.
function goodStory(over = {}) {
  return {
    id: 1,
    headline: "New telescope captures sharpest image of distant galaxy",
    summary: "Astronomers released the sharpest image yet of a distant galaxy.",
    category_id: "science",
    story_score: 42,
    confidence_score: 9,
    source_count: 5,
    key_points: ["Sharpest image to date", "Captured by a new telescope"],
    ...over,
  };
}

// ── countSourceDomains ────────────────────────────────────────────────────────

test("countSourceDomains: distinct domains from source_documents", () => {
  const story = { source_count: 9, source_documents: [
    { domain: "a.com" }, { domain: "a.com" }, { url: "https://b.org/x" }, { domain: "c.net" },
  ] };
  assert.equal(countSourceDomains(story), 3);
});

test("countSourceDomains: falls back to source_count when no docs", () => {
  assert.equal(countSourceDomains({ source_count: 4 }), 4);
  assert.equal(countSourceDomains({ source_count: 0 }), 0);
  assert.equal(countSourceDomains({}), 0);
});

// ── evaluateAutoApproval (5.1) ────────────────────────────────────────────────

test("evaluateAutoApproval: eligible when all §10.3 conditions met", () => {
  const r = evaluateAutoApproval(goodStory(), { flags: AUTO });
  assert.equal(r.eligible, true, r.reasons.join(", "));
  assert.deepEqual(r.reasons, []);
});

test("evaluateAutoApproval: each failing condition is reported", () => {
  assert.match(evaluateAutoApproval(goodStory({ confidence_score: 7 }), { flags: AUTO }).reasons.join(), /confidence/);
  assert.match(evaluateAutoApproval(goodStory({ story_score: 27 }), { flags: AUTO }).reasons.join(), /story_score/);
  assert.match(evaluateAutoApproval(goodStory({ source_count: 2, source_documents: [] }), { flags: AUTO }).reasons.join(), /unique_domains/);
  assert.match(evaluateAutoApproval(goodStory({ category_id: "world" }), { flags: AUTO }).reasons.join(), /not in safe list/);
});

// ── sensitive hard block (5.3) ────────────────────────────────────────────────

test("evaluateAutoApproval: sensitive story never eligible even if scores are high", () => {
  const violent = goodStory({ headline: "Explosion kills three at chemical plant", category_id: "science", story_score: 80, confidence_score: 10 });
  assert.equal(classifySensitivity(violent), SENSITIVITY.HIGH);
  const r = evaluateAutoApproval(violent, { flags: AUTO });
  assert.equal(r.eligible, false);
  assert.match(r.reasons.join(), /sensitivity=HIGH/);
});

// ── decideCandidateStatus (5.2) ───────────────────────────────────────────────

test("decideCandidateStatus: PENDING when auto-publish disabled (default)", () => {
  assert.equal(decideCandidateStatus(goodStory(), { autoEnabled: false, autoFlags: AUTO, autoRemaining: 3 }), "PENDING");
});

test("decideCandidateStatus: PENDING when daily budget exhausted", () => {
  assert.equal(decideCandidateStatus(goodStory(), { autoEnabled: true, autoFlags: AUTO, autoRemaining: 0 }), "PENDING");
});

test("decideCandidateStatus: AUTO_APPROVED when enabled, eligible, budget remains", () => {
  assert.equal(decideCandidateStatus(goodStory(), { autoEnabled: true, autoFlags: AUTO, autoRemaining: 1 }), "AUTO_APPROVED");
});

test("decideCandidateStatus: PENDING when enabled but story fails the gate", () => {
  const sensitive = goodStory({ headline: "Soldiers killed in border war" });
  assert.equal(decideCandidateStatus(sensitive, { autoEnabled: true, autoFlags: AUTO, autoRemaining: 3 }), "PENDING");
});

// ── generator auto status path (5.4) ──────────────────────────────────────────

function makeSupabaseMock({ candidate, story }) {
  const inserted = [];
  const candidateUpdates = [];
  function from(table) {
    const q = { table, _op: null, _payload: null, _filters: {} };
    q.select = () => q;
    q.eq = (k, v) => { q._filters[k] = v; return q; };
    q.upsert = (p) => { q._op = "upsert"; q._payload = p; return q; };
    q.update = (p) => { q._op = "update"; q._payload = p; return q; };
    q.maybeSingle = () => resolve(q);
    q.then = (res, rej) => resolve(q).then(res, rej);
    return q;
  }
  async function resolve(q) {
    if (q.table === "social_publication_candidates") {
      if (q._op === "update") { candidateUpdates.push(q._payload); return { data: null, error: null }; }
      return { data: candidate, error: null };
    }
    if (q.table === "stories") return { data: story, error: null };
    if (q.table === "social_posts") {
      if (q._op === "upsert") { const rec = { id: `p${inserted.length + 1}`, ...q._payload }; inserted.push(rec); return { data: { id: rec.id }, error: null }; }
      return { data: null, error: null }; // no existing
    }
    return { data: null, error: null };
  }
  return { client: { from }, inserted, candidateUpdates };
}

test("generateSocialPosts: AUTO_APPROVED candidate → X/FB APPROVED, IG PENDING_REVIEW, candidate kept AUTO_APPROVED", async () => {
  const candidate = { id: "c1", story_id: 1, audience_geo: "global", status: "AUTO_APPROVED" };
  const mock = makeSupabaseMock({ candidate, story: goodStory() });

  const res = await generateSocialPosts({ supabase: mock.client, candidateId: "c1" });
  assert.equal(res.created, 3);

  const byPlatform = Object.fromEntries(mock.inserted.map((p) => [p.platform, p.status]));
  assert.equal(byPlatform.x, "APPROVED");
  assert.equal(byPlatform.facebook, "APPROVED");
  assert.equal(byPlatform.instagram, "PENDING_REVIEW"); // needs media — never auto-approved
  // Candidate NOT downgraded to POST_GENERATED (stays AUTO_APPROVED for the daily cap).
  assert.equal(mock.candidateUpdates.length, 0);
});

test("generateSocialPosts: PENDING candidate → all PENDING_REVIEW (review-first default)", async () => {
  const candidate = { id: "c2", story_id: 1, audience_geo: "global", status: "PENDING" };
  const mock = makeSupabaseMock({ candidate, story: goodStory() });

  await generateSocialPosts({ supabase: mock.client, candidateId: "c2" });
  assert.ok(mock.inserted.every((p) => p.status === "PENDING_REVIEW"));
  assert.equal(mock.candidateUpdates.at(-1).status, "POST_GENERATED");
});
