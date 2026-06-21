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
// the SCHEDULED guard / lost race). Captures every update payload by row id.
function makeSupabase({ fetchRows = [], claimable = () => true } = {}) {
  const updates = []; // { id, payload }
  const client = {
    from(table) {
      const q = { table, _op: "select", _payload: null, _eqs: {} };
      q.select = () => q;
      q.eq = (k, v) => { q._eqs[k] = v; return q; };
      q.lte = () => q;
      q.not = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.update = (payload) => { q._op = "update"; q._payload = payload; return q; };
      q.maybeSingle = async () => {
        // The claim update: SCHEDULED → COMMENTING, conditional on still SCHEDULED.
        if (q._op === "update" && q._payload.comment_status === "COMMENTING") {
          const id = q._eqs.id;
          updates.push({ id, payload: q._payload });
          return { data: claimable(id) ? { id } : null, error: null };
        }
        return { data: null, error: null };
      };
      // Finalize updates (POSTED / FAILED / released SCHEDULED) resolve as thenables.
      q.then = (res, rej) => {
        if (q._op === "update") updates.push({ id: q._eqs.id, payload: q._payload });
        // The due-row SELECT also resolves here (no maybeSingle on it).
        const value = q._op === "select" ? { data: fetchRows, error: null } : { error: null };
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
    postComment: async () => { throw new Error("Instagram Graph 400: boom"); },
  });
  assert.deepEqual(res, { posted: 0, failed: 1, skipped: 0 });
  const fin = sb.updates.find((u) => u.payload.error_message);
  assert.equal(fin.payload.comment_status, "FAILED");
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
