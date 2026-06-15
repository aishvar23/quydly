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

const CREDS = { consumerKey: "k", consumerSecret: "s", token: "t", tokenSecret: "ts" };

test("x.publish: posts text with an OAuth 1.0a header and returns the tweet id", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ data: { id: "1789", text: "hi" } }) };
  };
  const out = await xPublish({ post_text: "Hello quydly.com" }, { creds: CREDS, fetchImpl });
  assert.equal(out.platformPostId, "1789");
  assert.equal(captured.url, "https://api.x.com/2/tweets");
  assert.match(captured.opts.headers.Authorization, /^OAuth /);
  assert.match(captured.opts.headers.Authorization, /oauth_signature_method="HMAC-SHA1"/);
  assert.equal(JSON.parse(captured.opts.body).text, "Hello quydly.com");
});

test("x.publish: throws on non-2xx", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ detail: "not allowed" }) });
  await assert.rejects(() => xPublish({ post_text: "x quydly.com" }, { creds: CREDS, fetchImpl }), /403.*not allowed/);
});

// ── Mock Supabase for the publisher ────────────────────────────────────────────

function makeSupabase({ duePosts, counts = {} }) {
  const byId = new Map(duePosts.map((p) => [p.id, { ...p }]));
  const updates = [];

  function from(table) {
    const q = { table, op: "select", filters: {}, payload: null, count: false, single: false };
    q.select = (_cols, opts) => { if (opts && opts.head) q.count = true; return q; };
    q.update = (payload) => { q.op = "update"; q.payload = payload; return q; };
    q.eq = (k, v) => { q.filters[k] = v; return q; };
    q.in = (k, v) => { q.filters[`in_${k}`] = v; return q; };
    q.is = (k, v) => { q.filters[`is_${k}`] = v; return q; };
    q.or = (clause) => { (q.orClauses ||= []).push(clause); return q; };
    q.gte = () => q; q.lte = () => q;
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
    // carousel slide lookups aren't under test here.
    if (q.table === "social_media_assets") return { data: [], error: null };
    // Posts fetch: honour the platform allow-list (the publisher excludes capped
    // platforms from the query), so the mock reflects which rows actually return.
    let rows = duePosts;
    if (q.filters.in_platform) rows = rows.filter((p) => q.filters.in_platform.includes(p.platform));
    // Honour the media-exclusion or-clause the publisher applies: a media-required
    // platform's media-less rows are filtered OUT of the fetch (keep only rows with
    // media, or rows whose platform is in the media-optional allow-list).
    const mediaClause = (q.orClauses || []).find((c) => c.includes("media_url.not.is.null"));
    if (mediaClause) {
      const m = mediaClause.match(/platform\.in\.\(([^)]*)\)/);
      const optional = m ? m[1].split(",").filter(Boolean) : [];
      rows = rows.filter((p) => p.media_url != null || optional.includes(p.platform));
    }
    return { data: rows, error: null };
  }

  return { client: { from }, byId, updates };
}

const CREDS_FN = () => ({ consumerKey: "k", consumerSecret: "s", token: "t", tokenSecret: "ts" });

function xPost(id, over = {}) {
  return { id, story_id: 1, platform: "x", audience_geo: "global", post_text: "Post quydly.com",
    media_url: null, status: "APPROVED", scheduled_for: null, platform_post_id: null, ...over };
}

// ── Worker ─────────────────────────────────────────────────────────────────────

test("publishApprovedPosts: publishes due X posts and stores tweet id", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a"), xPost("b")] });
  const publishers = { x: async (post) => ({ platformPostId: `t_${post.id}`, rawResponse: { data: { id: `t_${post.id}` } } }) };
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getCreds: CREDS_FN, env: {} });

  assert.deepEqual(res, { published: 2, failed: 0, skipped: 0 });
  assert.equal(sb.byId.get("a").status, "POSTED");
  assert.equal(sb.byId.get("a").platform_post_id, "t_a");
});

test("publishApprovedPosts: failure marks FAILED with error_message", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a")] });
  const publishers = { x: async () => { throw new Error("rate limited"); } };
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getCreds: CREDS_FN, env: {} });

  assert.deepEqual(res, { published: 0, failed: 1, skipped: 0 });
  assert.equal(sb.byId.get("a").status, "FAILED");
  assert.match(sb.byId.get("a").error_message, /rate limited/);
});

test("publishApprovedPosts: respects per-day cap", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a"), xPost("b")], counts: { x: 1 } });
  const publishers = { x: async (p) => ({ platformPostId: `t_${p.id}`, rawResponse: {} }) };
  // cap 1, already 1 posted today → 0 remaining. X is the only platform and it's
  // capped, so it's excluded from the fetch entirely (nothing published, nothing
  // even claimed/skipped) and the posts are left APPROVED for the next window.
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getCreds: CREDS_FN, env: { SOCIAL_MAX_X_POSTS_PER_DAY: "1" } });
  assert.equal(res.published, 0);
  assert.equal(sb.byId.get("a").status, "APPROVED");
  assert.equal(sb.byId.get("b").status, "APPROVED");
});

test("publishApprovedPosts: a capped platform does not starve a publishable one", async () => {
  // Regression: X is capped (cap 1, 1 already posted) and its APPROVED backlog
  // is OLDER than IG's. Ordered oldest-first, X would fill the batch and starve
  // IG. The publisher must exclude capped X from the fetch so IG still publishes.
  const ig = { id: "ig1", story_id: 2, platform: "instagram", audience_geo: "global",
    post_text: "cap quydly.com", media_url: "https://cdn.test/0.jpg", status: "APPROVED",
    scheduled_for: null, platform_post_id: null };
  const sb = makeSupabase({ duePosts: [xPost("x1"), xPost("x2"), ig], counts: { x: 1 } });
  const calls = [];
  const publishers = {
    x: async (p) => { calls.push("x"); return { platformPostId: `t_${p.id}`, rawResponse: {} }; },
    instagram: async (p) => { calls.push("ig"); return { platformPostId: `ig_${p.id}`, rawResponse: {} }; },
  };
  const res = await publishApprovedPosts({
    supabase: sb.client, publishers, getCreds: CREDS_FN, getIgCreds: CREDS_FN,
    env: { SOCIAL_MAX_X_POSTS_PER_DAY: "1", SOCIAL_MAX_INSTAGRAM_POSTS_PER_DAY: "25" },
  });
  assert.equal(res.published, 1);                       // the IG post published
  assert.deepEqual(calls, ["ig"]);                      // X never attempted (excluded from fetch)
  assert.equal(sb.byId.get("ig1").status, "POSTED");
  assert.equal(sb.byId.get("x1").status, "APPROVED");   // X left for the next window
});

test("publishApprovedPosts: media-less rows of a media-required platform don't starve the batch", async () => {
  // Regression: a backlog of media-less Facebook drafts (legacy AUTO_APPROVED rows
  // created before card rendering) is OLDER than a carded Instagram post. Ordered
  // oldest-first, those FB rows would fill the BATCH and all get skipped (no media),
  // starving IG. The publisher must EXCLUDE media-less rows of media-required
  // platforms from the fetch, so they never enter the batch.
  const fbA = { id: "fbA", story_id: 1, platform: "facebook", audience_geo: "global",
    post_text: "fb quydly.com", media_url: null, status: "APPROVED", scheduled_for: null, platform_post_id: null };
  const fbB = { ...fbA, id: "fbB" };
  const ig = { id: "ig1", story_id: 2, platform: "instagram", audience_geo: "global",
    post_text: "ig quydly.com", media_url: "https://cdn.test/0.jpg", status: "APPROVED",
    scheduled_for: null, platform_post_id: null };
  const sb = makeSupabase({ duePosts: [fbA, fbB, ig] });
  const calls = [];
  const publishers = {
    facebook: async (p) => { calls.push("fb"); return { platformPostId: `fb_${p.id}`, rawResponse: {} }; },
    instagram: async (p) => { calls.push("ig"); return { platformPostId: `ig_${p.id}`, rawResponse: {} }; },
  };
  const res = await publishApprovedPosts({
    supabase: sb.client, publishers, getIgCreds: CREDS_FN, getFbCreds: CREDS_FN,
    env: { SOCIAL_MAX_FACEBOOK_POSTS_PER_DAY: "10", SOCIAL_MAX_INSTAGRAM_POSTS_PER_DAY: "25" },
  });
  assert.equal(res.published, 1);                  // IG published
  assert.equal(res.skipped, 0);                    // FB rows excluded from fetch, NOT fetched-then-skipped
  assert.deepEqual(calls, ["ig"]);
  assert.equal(sb.byId.get("ig1").status, "POSTED");
  assert.equal(sb.byId.get("fbA").status, "APPROVED"); // left untouched, not skipped
});

test("publishApprovedPosts: never publishes Instagram without media (#16)", async () => {
  const igPost = { id: "ig", story_id: 1, platform: "instagram", audience_geo: "global",
    post_text: "cap quydly.com", media_url: null, status: "APPROVED", scheduled_for: null, platform_post_id: null };
  const sb = makeSupabase({ duePosts: [igPost] });
  let called = false;
  const publishers = { instagram: async () => { called = true; return { platformPostId: "x", rawResponse: {} }; } };
  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getCreds: CREDS_FN, env: {} });
  assert.equal(called, false);                        // never published (#16)
  // Media-less IG rows are now excluded at the fetch (not fetched-then-skipped),
  // so they don't count as skipped; the in-loop media gate remains as a backstop.
  assert.equal(res.skipped, 0);
  assert.equal(sb.byId.get("ig").status, "APPROVED"); // untouched
});
