#!/usr/bin/env node
// Unit tests for Phase 4 publishing (no network — fake fetch + mock Supabase).
//
// Usage: node --test test/social-publisher.test.js
//
// Covers: 4.1 X publish client · 4.2/4.3 worker + idempotency claim ·
//         4.4 success/failure persistence · per-day cap · IG media gate (#16).

import { test } from "node:test";
import assert from "node:assert/strict";

import { publish as xPublish } from "../lib/social/platforms/x.js";
import { publishApprovedPosts } from "../lib/social/social-publisher.js";

// ── X publish client ──────────────────────────────────────────────────────────

test("x.publish: posts text and returns the tweet id", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ data: { id: "1789", text: "hi" } }) };
  };
  const out = await xPublish({ post_text: "Hello quydly.com" }, { accessToken: "tok", fetchImpl });
  assert.equal(out.platformPostId, "1789");
  assert.equal(captured.url, "https://api.x.com/2/tweets");
  assert.equal(captured.opts.headers.Authorization, "Bearer tok");
  assert.equal(JSON.parse(captured.opts.body).text, "Hello quydly.com");
});

test("x.publish: throws on non-2xx", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ detail: "not allowed" }) });
  await assert.rejects(() => xPublish({ post_text: "x quydly.com" }, { accessToken: "t", fetchImpl }), /403.*not allowed/);
});

// ── Mock Supabase for the publisher ────────────────────────────────────────────

function makeSupabase({ duePosts, counts = {} }) {
  const byId = new Map(duePosts.map((p) => [p.id, { ...p }]));
  const updates = [];

  function from() {
    const q = { op: "select", filters: {}, payload: null, count: false, single: false };
    q.select = (_cols, opts) => { if (opts && opts.head) q.count = true; return q; };
    q.update = (payload) => { q.op = "update"; q.payload = payload; return q; };
    q.eq = (k, v) => { q.filters[k] = v; return q; };
    q.in = (k, v) => { q.filters[`in_${k}`] = v; return q; };
    q.is = (k, v) => { q.filters[`is_${k}`] = v; return q; };
    q.or = () => q; q.gte = () => q; q.lte = () => q;
    q.order = () => q; q.limit = () => q;
    q.maybeSingle = () => { q.single = true; return resolve(q); };
    q.then = (res, rej) => resolve(q).then(res, rej);
    return q;
  }

  async function resolve(q) {
    if (q.op === "update") {
      const id = q.filters.id;
      const post = byId.get(id);
      if (q.single) {
        // claim: must currently be APPROVED/SCHEDULED with no tweet id
        const ok = post && post.platform_post_id == null && ["APPROVED", "SCHEDULED"].includes(post.status);
        if (ok) { post.status = "PUBLISHING"; updates.push({ id, ...q.payload }); return { data: { id }, error: null }; }
        return { data: null, error: null };
      }
      if (post) Object.assign(post, q.payload);
      updates.push({ id, ...q.payload });
      return { error: null };
    }
    if (q.count) {
      const platform = q.filters.platform;
      return { count: counts[platform] || 0, error: null };
    }
    return { data: duePosts, error: null };
  }

  return { client: { from }, byId, updates };
}

const TOKEN = async () => ({ accessToken: "tok" });

function xPost(id, over = {}) {
  return { id, story_id: 1, platform: "x", audience_geo: "global", post_text: "Post quydly.com",
    media_url: null, status: "APPROVED", scheduled_for: null, platform_post_id: null, ...over };
}

// ── Worker ─────────────────────────────────────────────────────────────────────

test("publishApprovedPosts: publishes due X posts and stores tweet id", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a"), xPost("b")] });
  const publishers = { x: async (post) => ({ platformPostId: `t_${post.id}`, rawResponse: { data: { id: `t_${post.id}` } } }) };
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getToken: TOKEN, env: {} });

  assert.deepEqual(res, { published: 2, failed: 0, skipped: 0 });
  assert.equal(sb.byId.get("a").status, "POSTED");
  assert.equal(sb.byId.get("a").platform_post_id, "t_a");
});

test("publishApprovedPosts: failure marks FAILED with error_message", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a")] });
  const publishers = { x: async () => { throw new Error("rate limited"); } };
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getToken: TOKEN, env: {} });

  assert.deepEqual(res, { published: 0, failed: 1, skipped: 0 });
  assert.equal(sb.byId.get("a").status, "FAILED");
  assert.match(sb.byId.get("a").error_message, /rate limited/);
});

test("publishApprovedPosts: respects per-day cap", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a"), xPost("b")], counts: { x: 1 } });
  const publishers = { x: async (p) => ({ platformPostId: `t_${p.id}`, rawResponse: {} }) };
  // cap 1, already 1 posted today → 0 remaining → both skipped
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getToken: TOKEN, env: { SOCIAL_MAX_X_POSTS_PER_DAY: "1" } });
  assert.equal(res.published, 0);
  assert.equal(res.skipped, 2);
});

test("publishApprovedPosts: never publishes Instagram without media (#16)", async () => {
  const igPost = { id: "ig", story_id: 1, platform: "instagram", audience_geo: "global",
    post_text: "cap quydly.com", media_url: null, status: "APPROVED", scheduled_for: null, platform_post_id: null };
  const sb = makeSupabase({ duePosts: [igPost] });
  let called = false;
  const publishers = { instagram: async () => { called = true; return { platformPostId: "x", rawResponse: {} }; } };
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getToken: TOKEN, env: {} });
  assert.equal(called, false);
  assert.equal(res.skipped, 1);
  assert.equal(sb.byId.get("ig").status, "APPROVED"); // untouched
});
