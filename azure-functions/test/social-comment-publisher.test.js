#!/usr/bin/env node
// Unit tests for the IG engagement comment worker — no network.
//
// Usage: node --test test/social-comment-publisher.test.js
//
// Covers: postComment() Graph call (params, dry-run, error) · due-row selection ·
//         exactly-once claim (SCHEDULED → COMMENTING) · message formatting ·
//         success (POSTED + comment_platform_id) · failure with bounded retry
//         (release to SCHEDULED, then FAILED at the cap) · gating (flag off /
//         missing creds) · idempotency (lost claim → skipped, no comment posted).

import { test } from "node:test";
import assert from "node:assert/strict";

import * as ig from "../lib/social/instagram-graph.js";
import { publishDueComments, buildCommentMessage } from "../lib/social/social-comment-publisher.js";

const CREDS = { igUserId: "17841400000000000", accessToken: "PAGE_TOKEN", graphVersion: "v25.0" };
const ENABLED = { SOCIAL_IG_ENGAGEMENT_ENABLED: "true" };

function dueRow(overrides = {}) {
  return {
    id: "eng-1",
    social_post_id: "post-1",
    ig_media_id: "IGMEDIA_1",
    question: "Which bank cut rates?",
    options: ["Fed", "ECB", "BoE", "BoJ"],
    correct_index: 0,
    answer: "Fed",
    comment_status: "SCHEDULED",
    comment_due_at: "2026-06-20T00:00:00Z",
    comment_attempts: 0,
    ...overrides,
  };
}

// Mock Supabase for the comment worker. `fetchRows` is what the due-row SELECT
// returns; `claimable(id)` decides whether the conditional claim succeeds (models
// the SCHEDULED guard / lost race). `reclaimRows` is what the COMMENTING-reclaim
// UPDATE ... .select("id") returns (the stuck rows released back to SCHEDULED).
// Captures every update payload by row id.
function makeSupabase({ fetchRows = [], claimable = () => true, reclaimRows = [] } = {}) {
  const updates = []; // { id, payload }
  const client = {
    from(table) {
      const q = { table, _op: "select", _payload: null, _eqs: {}, _selected: false };
      q.select = () => { q._selected = true; return q; };
      q.eq = (k, v) => { q._eqs[k] = v; return q; };
      q.lte = () => q;
      q.lt = () => q;
      q.not = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.update = (payload) => { q._op = "update"; q._payload = payload; return q; };
      // The reclaim UPDATE filters on comment_status=COMMENTING with no row id.
      const isReclaim = () =>
        q._op === "update" && q._eqs.comment_status === "COMMENTING" && q._eqs.id == null;
      q.maybeSingle = async () => {
        // The claim update: SCHEDULED → COMMENTING, conditional on still SCHEDULED.
        if (q._op === "update" && q._payload.comment_status === "COMMENTING") {
          const id = q._eqs.id;
          updates.push({ id, payload: q._payload });
          return { data: claimable(id) ? { id } : null, error: null };
        }
        return { data: null, error: null };
      };
      // Reclaim update + due-row SELECT + finalize updates resolve as thenables.
      q.then = (res, rej) => {
        let value;
        if (isReclaim()) {
          updates.push({ id: null, payload: q._payload, reclaim: true });
          value = { data: reclaimRows, error: null };
        } else if (q._op === "update") {
          updates.push({ id: q._eqs.id, payload: q._payload });
          value = { error: null };
        } else {
          value = { data: fetchRows, error: null };
        }
        return Promise.resolve(value).then(res, rej);
      };
      return q;
    },
  };
  return { client, updates };
}

// ── postComment (Graph call) ───────────────────────────────────────────────────

test("postComment: POSTs /{mediaId}/comments with message + access_token, returns comment id", async () => {
  let calledUrl, calledBody;
  const fetchImpl = async (url, opts) => {
    calledUrl = url;
    calledBody = opts.body;
    return { ok: true, status: 200, json: async () => ({ id: "COMMENT_42" }) };
  };
  const { commentId, rawResponse } = await ig.postComment({ creds: CREDS, mediaId: "IGMEDIA_1", message: "hi there", fetchImpl });
  assert.equal(commentId, "COMMENT_42");
  assert.equal(rawResponse.id, "COMMENT_42");
  assert.ok(calledUrl.includes("/v25.0/IGMEDIA_1/comments"));
  assert.ok(calledBody.includes("message=hi+there"));
  assert.ok(calledBody.includes("access_token=PAGE_TOKEN"));
});

test("postComment: dryRun hits no endpoint and returns a synthetic id", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const { commentId } = await ig.postComment({ creds: CREDS, mediaId: "IGMEDIA_1", message: "x", fetchImpl, dryRun: true });
  assert.equal(called, false);
  assert.ok(commentId.startsWith("DRYRUN-COMMENT-"));
});

test("postComment: Graph error (190 expired/unscoped token) throws Instagram Graph", async () => {
  const fetchImpl = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: { code: 190, message: "Invalid OAuth access token." } }),
  });
  await assert.rejects(
    ig.postComment({ creds: CREDS, mediaId: "IGMEDIA_1", message: "x", fetchImpl }),
    /Instagram Graph 400:.*code=190/
  );
});

test("postComment: missing mediaId / empty message throw before any call", async () => {
  await assert.rejects(ig.postComment({ creds: CREDS, message: "x" }), /missing mediaId/);
  await assert.rejects(ig.postComment({ creds: CREDS, mediaId: "m", message: "   " }), /empty message/);
});

// ── message formatting ─────────────────────────────────────────────────────────

test("buildCommentMessage: exact format with correct option text", () => {
  const msg = buildCommentMessage(dueRow());
  assert.equal(msg, "Yesterday's question: Which bank cut rates? — Answer: Fed. Play the full quiz at quydly.com");
});

test("buildCommentMessage: falls back to options[correct_index] when answer missing", () => {
  const msg = buildCommentMessage(dueRow({ answer: null, correct_index: 2 }));
  assert.ok(msg.includes("Answer: BoE."));
});

// ── worker: gating ─────────────────────────────────────────────────────────────

test("publishDueComments: flag off → no-op, no fetch, nothing claimed", async () => {
  const sb = makeSupabase({ fetchRows: [dueRow()] });
  let credsCalled = false;
  const res = await publishDueComments({
    supabase: sb.client,
    env: {}, // SOCIAL_IG_ENGAGEMENT_ENABLED unset
    getCreds: () => { credsCalled = true; return CREDS; },
    postComment: async () => { throw new Error("should not be called"); },
  });
  assert.deepEqual(res, { posted: 0, failed: 0, skipped: 0 });
  assert.equal(credsCalled, false);
  assert.equal(sb.updates.length, 0);
});

test("publishDueComments: missing creds → no-op WITHOUT claiming any row", async () => {
  const sb = makeSupabase({ fetchRows: [dueRow()] });
  let posted = false;
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => { throw new Error("META_PAGE_ACCESS_TOKEN missing"); },
    postComment: async () => { posted = true; return { commentId: "c" }; },
  });
  assert.deepEqual(res, { posted: 0, failed: 0, skipped: 0 });
  assert.equal(posted, false);
  assert.equal(sb.updates.length, 0); // never claimed → rows stay SCHEDULED
});

// ── worker: happy path ─────────────────────────────────────────────────────────

test("publishDueComments: due SCHEDULED row → claims, posts comment, marks POSTED", async () => {
  const sb = makeSupabase({ fetchRows: [dueRow()] });
  let postedMedia, postedMessage;
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    postComment: async ({ mediaId, message }) => { postedMedia = mediaId; postedMessage = message; return { commentId: "COMMENT_42" }; },
  });
  assert.deepEqual(res, { posted: 1, failed: 0, skipped: 0 });
  assert.equal(postedMedia, "IGMEDIA_1");
  assert.equal(postedMessage, "Yesterday's question: Which bank cut rates? — Answer: Fed. Play the full quiz at quydly.com");

  // claim (COMMENTING, attempts=1) then finalize (POSTED + comment_platform_id).
  const claim = sb.updates.find((u) => u.payload.comment_status === "COMMENTING");
  assert.ok(claim);
  assert.equal(claim.payload.comment_attempts, 1);
  const done = sb.updates.find((u) => u.payload.comment_status === "POSTED");
  assert.ok(done);
  assert.equal(done.payload.comment_platform_id, "COMMENT_42");
  assert.equal(done.payload.error_message, null);
});

// ── worker: exactly-once / idempotency ─────────────────────────────────────────

test("publishDueComments: lost claim race → skipped, comment NOT posted", async () => {
  const sb = makeSupabase({ fetchRows: [dueRow()], claimable: () => false }); // another worker won
  let posted = false;
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    postComment: async () => { posted = true; return { commentId: "c" }; },
  });
  assert.deepEqual(res, { posted: 0, failed: 0, skipped: 1 });
  assert.equal(posted, false); // never posts when the claim is lost
  // Only the (failed) claim attempt; no POSTED/FAILED finalize.
  assert.ok(!sb.updates.some((u) => ["POSTED", "FAILED"].includes(u.payload.comment_status)));
});

// ── worker: failure + bounded retry ────────────────────────────────────────────

test("publishDueComments: Graph failure under cap → released to SCHEDULED (retry) with error_message", async () => {
  const sb = makeSupabase({ fetchRows: [dueRow({ comment_attempts: 0 })] });
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    postComment: async () => { throw new Error("Instagram Graph 400: code=190 Invalid OAuth"); },
  });
  assert.deepEqual(res, { posted: 0, failed: 1, skipped: 0 });
  const fin = sb.updates.find((u) => u.payload.error_message);
  assert.equal(fin.payload.comment_status, "SCHEDULED"); // attempt 1 < 3 → retry
  assert.ok(fin.payload.error_message.includes("code=190"));
});

test("publishDueComments: Graph failure at cap → FAILED (terminal)", async () => {
  // comment_attempts=2 → this claim is attempt 3 = MAX_ATTEMPTS → terminal.
  const sb = makeSupabase({ fetchRows: [dueRow({ comment_attempts: 2 })] });
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    // attempts ≥ 1 → dedup check runs first; no existing comment → falls through.
    listComments: async () => [],
    postComment: async () => { throw new Error("Instagram Graph 400: boom"); },
  });
  assert.deepEqual(res, { posted: 0, failed: 1, skipped: 0 });
  const fin = sb.updates.find((u) => u.payload.error_message);
  assert.equal(fin.payload.comment_status, "FAILED");
});

// ── worker: retry idempotency (Fix 1 — dedup via listComments) ──────────────────

test("publishDueComments: retry where matching comment already exists → marked POSTED, postComment NOT called", async () => {
  // Prior attempt actually posted (comment_attempts=1) but lost the response.
  const row = dueRow({ comment_attempts: 1 });
  const sb = makeSupabase({ fetchRows: [row] });
  const message = buildCommentMessage(row);
  let listedMedia, postCalled = false;
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    listComments: async ({ mediaId }) => { listedMedia = mediaId; return [{ id: "EXISTING_99", text: message }]; },
    postComment: async () => { postCalled = true; return { commentId: "SHOULD_NOT_HAPPEN" }; },
  });
  assert.deepEqual(res, { posted: 1, failed: 0, skipped: 0 });
  assert.equal(postCalled, false); // never double-posts
  assert.equal(listedMedia, "IGMEDIA_1");
  const done = sb.updates.find((u) => u.payload.comment_status === "POSTED");
  assert.ok(done);
  assert.equal(done.payload.comment_platform_id, "EXISTING_99"); // adopts the existing comment's id
});

test("publishDueComments: retry with NO matching comment → posts normally", async () => {
  const row = dueRow({ comment_attempts: 1 });
  const sb = makeSupabase({ fetchRows: [row] });
  let postCalled = false;
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    // Existing comments exist but none match the message we're about to post.
    listComments: async () => [{ id: "OTHER_1", text: "an unrelated comment" }],
    postComment: async () => { postCalled = true; return { commentId: "COMMENT_77" }; },
  });
  assert.deepEqual(res, { posted: 1, failed: 0, skipped: 0 });
  assert.equal(postCalled, true);
  const done = sb.updates.find((u) => u.payload.comment_status === "POSTED");
  assert.equal(done.payload.comment_platform_id, "COMMENT_77");
});

test("publishDueComments: first attempt (comment_attempts=0) skips the dedup listComments call", async () => {
  const sb = makeSupabase({ fetchRows: [dueRow({ comment_attempts: 0 })] });
  let listCalled = false;
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    listComments: async () => { listCalled = true; return []; },
    postComment: async () => ({ commentId: "COMMENT_5" }),
  });
  assert.deepEqual(res, { posted: 1, failed: 0, skipped: 0 });
  assert.equal(listCalled, false); // no extra Graph call on the common first-attempt path
});

// ── worker: reclaim stuck COMMENTING rows (Fix 2) ───────────────────────────────

test("publishDueComments: stale COMMENTING row is reclaimed to SCHEDULED, then processed", async () => {
  // The reclaim UPDATE returns one row id; that same row then comes back as a due
  // SCHEDULED row (comment_attempts=1 since it was claimed before) and posts.
  const due = dueRow({ comment_attempts: 1 });
  const sb = makeSupabase({ fetchRows: [due], reclaimRows: [{ id: "eng-1" }] });
  let postCalled = false;
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    listComments: async () => [], // no existing comment → posts
    postComment: async () => { postCalled = true; return { commentId: "COMMENT_R" }; },
    now: new Date("2026-06-21T00:00:00Z"),
  });
  assert.deepEqual(res, { posted: 1, failed: 0, skipped: 0 });
  assert.equal(postCalled, true);
  // A reclaim UPDATE (COMMENTING → SCHEDULED) was issued.
  const reclaim = sb.updates.find((u) => u.reclaim);
  assert.ok(reclaim);
  assert.equal(reclaim.payload.comment_status, "SCHEDULED");
});

test("publishDueComments: fresh COMMENTING row is left alone (reclaim returns none)", async () => {
  // No stuck rows to reclaim, and no due SCHEDULED rows → nothing posted/claimed.
  const sb = makeSupabase({ fetchRows: [], reclaimRows: [] });
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    listComments: async () => { throw new Error("should not be called"); },
    postComment: async () => { throw new Error("should not be called"); },
  });
  assert.deepEqual(res, { posted: 0, failed: 0, skipped: 0 });
  // The reclaim UPDATE still ran, but matched nothing → no finalize/claim updates.
  assert.ok(!sb.updates.some((u) => u.payload && u.payload.comment_status === "COMMENTING"));
});

// ── worker: empty ──────────────────────────────────────────────────────────────

test("publishDueComments: no due rows → posted/failed/skipped all 0", async () => {
  const sb = makeSupabase({ fetchRows: [] });
  const res = await publishDueComments({
    supabase: sb.client,
    env: ENABLED,
    getCreds: () => CREDS,
    postComment: async () => { throw new Error("should not be called"); },
  });
  assert.deepEqual(res, { posted: 0, failed: 0, skipped: 0 });
});
