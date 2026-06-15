#!/usr/bin/env node
// Unit tests for the Facebook Page publishing path (no network — injected fetch
// stubs + mock Supabase).
//
// Usage: node --test test/social-fb-publish.test.js
//
// Covers:
//   facebook-graph.publish · /photos request shape (url + caption)
//                          · creds-missing throws · missing/non-HTTPS image throws
//                          · dry-run hits no endpoint
//   social-publisher       · dispatches `facebook` → POSTED + platform_post_id
//                          · no-media FB post is gated (stays unpublished)

import { test } from "node:test";
import assert from "node:assert/strict";

import { publish as fbPublish, credsFromEnv as fbCredsFromEnv } from "../lib/social/facebook-graph.js";
import { publishApprovedPosts } from "../lib/social/social-publisher.js";
import { requiresMedia, PLATFORM_REGISTRY } from "../lib/social/platforms/index.js";
import * as x from "../lib/social/platforms/x.js";
import * as instagram from "../lib/social/platforms/instagram.js";
import * as facebook from "../lib/social/platforms/facebook.js";

const FB_CREDS = { pageId: "1196631670191325", accessToken: "tok", graphVersion: "v25.0" };
const IMG = "https://cdn.test/cards/story/square.jpg";

// ── facebook-graph.publish ─────────────────────────────────────────────────────

test("fb.publish: POSTs /photos with url + caption and returns post_id", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: opts.body, method: opts.method };
    return { ok: true, json: async () => ({ id: "media_1", post_id: "1196_999" }) };
  };
  const out = await fbPublish({ post_text: "Hello quydly.com", media_url: IMG }, { creds: FB_CREDS, fetchImpl });

  assert.equal(out.platformPostId, "1196_999"); // post_id preferred over id
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, "https://graph.facebook.com/v25.0/1196631670191325/photos");
  const params = new URLSearchParams(captured.body);
  assert.equal(params.get("url"), IMG);
  assert.equal(params.get("caption"), "Hello quydly.com");
  assert.equal(params.get("access_token"), "tok");
});

test("fb.publish: falls back to id when post_id absent", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ id: "media_only" }) });
  const out = await fbPublish({ post_text: "x", media_url: IMG }, { creds: FB_CREDS, fetchImpl });
  assert.equal(out.platformPostId, "media_only");
});

test("fb.publish: surfaces Graph error code/subcode/message on non-2xx", async () => {
  const fetchImpl = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: { message: "Invalid OAuth token", code: 190, error_subcode: 460 } }),
  });
  await assert.rejects(
    () => fbPublish({ post_text: "x", media_url: IMG }, { creds: FB_CREDS, fetchImpl }),
    /Facebook Graph 400: Invalid OAuth token.*code=190.*subcode=460/
  );
});

test("fb.publish: throws when image url missing", async () => {
  await assert.rejects(
    () => fbPublish({ post_text: "x" }, { creds: FB_CREDS, fetchImpl: async () => ({}) }),
    /no image url/
  );
});

test("fb.publish: throws when image url is non-HTTPS", async () => {
  await assert.rejects(
    () => fbPublish({ post_text: "x", media_url: "http://insecure/x.jpg" }, { creds: FB_CREDS, fetchImpl: async () => ({}) }),
    /must be public HTTPS/
  );
});

test("fb.publish: dry-run assembles request and hits no endpoint", async () => {
  let fetched = false;
  const out = await fbPublish(
    { post_text: "dry caption", media_url: IMG },
    { creds: FB_CREDS, dryRun: true, fetchImpl: async () => { fetched = true; return {}; } }
  );
  assert.equal(fetched, false);
  assert.equal(out.platformPostId, "DRYRUN-fb-photo");
  assert.equal(out.rawResponse.url, IMG);
  assert.equal(out.rawResponse.caption, "dry caption");
});

// ── credsFromEnv ───────────────────────────────────────────────────────────────

test("fb.credsFromEnv: resolves page id, token, graph version", () => {
  const creds = fbCredsFromEnv({
    FACEBOOK_PAGE_ID: "1196631670191325",
    META_PAGE_ACCESS_TOKEN: "tok",
    META_GRAPH_VERSION: "v25.0",
  });
  assert.deepEqual(creds, { pageId: "1196631670191325", accessToken: "tok", graphVersion: "v25.0" });
});

test("fb.credsFromEnv: defaults graph version and throws listing missing vars", () => {
  // default version when META_GRAPH_VERSION unset.
  const c = fbCredsFromEnv({ FACEBOOK_PAGE_ID: "p", META_PAGE_ACCESS_TOKEN: "t" });
  assert.equal(c.graphVersion, "v21.0");
  // missing page id + token are both reported.
  assert.throws(() => fbCredsFromEnv({}), /FACEBOOK_PAGE_ID.*META_PAGE_ACCESS_TOKEN/);
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
        const ok = post && post.platform_post_id == null && ["APPROVED", "SCHEDULED"].includes(post.status);
        if (ok) { post.status = "PUBLISHING"; updates.push({ id, ...q.payload }); return { data: { id }, error: null }; }
        return { data: null, error: null };
      }
      if (post) Object.assign(post, q.payload);
      updates.push({ id, ...q.payload });
      return { error: null };
    }
    if (q.count) return { count: counts[q.filters.platform] || 0, error: null };
    if (q.table === "social_media_assets") return { data: [], error: null };
    let rows = duePosts;
    if (q.filters.in_platform) rows = rows.filter((p) => q.filters.in_platform.includes(p.platform));
    return { data: rows, error: null };
  }
  function fromTable(table) { const q = from(); q.table = table; return q; }

  return { client: { from: fromTable }, byId, updates };
}

const CREDS_FN = () => FB_CREDS;

function fbPost(id, over = {}) {
  return { id, story_id: 1, platform: "facebook", audience_geo: "global", post_text: "Post quydly.com",
    media_url: IMG, status: "APPROVED", scheduled_for: null, platform_post_id: null, ...over };
}

// ── Publisher dispatch ─────────────────────────────────────────────────────────

test("publishApprovedPosts: dispatches facebook → POSTED with platform_post_id", async () => {
  const sb = makeSupabase({ duePosts: [fbPost("f1")] });
  const calls = [];
  const publishers = {
    facebook: async (p) => { calls.push("fb"); return { platformPostId: `fbid_${p.id}`, rawResponse: { post_id: `fbid_${p.id}` } }; },
  };
  const res = await publishApprovedPosts({
    supabase: sb.client, publishers,
    getIgCreds: CREDS_FN,
    env: { FACEBOOK_PAGE_ID: "p", META_PAGE_ACCESS_TOKEN: "t" },
  });

  assert.deepEqual(calls, ["fb"]);
  assert.equal(res.published, 1);
  assert.equal(sb.byId.get("f1").status, "POSTED");
  assert.equal(sb.byId.get("f1").platform_post_id, "fbid_f1");
});

test("publishApprovedPosts: never publishes facebook without media", async () => {
  const sb = makeSupabase({ duePosts: [fbPost("f0", { media_url: null })] });
  let called = false;
  const publishers = { facebook: async () => { called = true; return { platformPostId: "x", rawResponse: {} }; } };
  const res = await publishApprovedPosts({
    supabase: sb.client, publishers,
    env: { FACEBOOK_PAGE_ID: "p", META_PAGE_ACCESS_TOKEN: "t" },
  });
  assert.equal(called, false);
  assert.equal(res.skipped, 1);
  assert.equal(sb.byId.get("f0").status, "APPROVED"); // untouched, left for review
});

test("publishApprovedPosts: facebook day cap defaults to 10", async () => {
  // 10 already posted today → 0 remaining → facebook excluded from the fetch.
  const sb = makeSupabase({ duePosts: [fbPost("f1")], counts: { facebook: 10 } });
  let called = false;
  const publishers = { facebook: async () => { called = true; return { platformPostId: "x", rawResponse: {} }; } };
  const res = await publishApprovedPosts({
    supabase: sb.client, publishers,
    env: { FACEBOOK_PAGE_ID: "p", META_PAGE_ACCESS_TOKEN: "t" },
  });
  assert.equal(called, false);
  assert.equal(res.published, 0);
  assert.equal(sb.byId.get("f1").status, "APPROVED");
});

// ── media gate is DERIVED from CONSTRAINTS (de-dup lock-in) ──────────────────────

test("requiresMedia() is derived from each platform's CONSTRAINTS.requiresMedia", () => {
  // No hand-maintained platform list: the gate reads CONSTRAINTS directly.
  assert.equal(requiresMedia("instagram"), instagram.CONSTRAINTS.requiresMedia === true);
  assert.equal(requiresMedia("facebook"), facebook.CONSTRAINTS.requiresMedia === true);
  assert.equal(requiresMedia("x"), x.CONSTRAINTS.requiresMedia === true);
  // Current truth table.
  assert.equal(requiresMedia("instagram"), true);
  assert.equal(requiresMedia("facebook"), true);
  assert.equal(requiresMedia("x"), false);
  // Unknown platform → not gated.
  assert.equal(requiresMedia("mastodon"), false);
  // The registry is keyed by the PLATFORM constant.
  assert.equal(PLATFORM_REGISTRY.facebook, facebook);
});

test("publisher media gate follows CONSTRAINTS.requiresMedia (flip changes gating)", async () => {
  // Flip X to require media: a no-media X post must now be gated/skipped, proving
  // the publisher reads CONSTRAINTS rather than a hardcoded {instagram,facebook} set.
  const original = x.CONSTRAINTS.requiresMedia;
  x.CONSTRAINTS.requiresMedia = true;
  try {
    const sb = makeSupabase({ duePosts: [
      { id: "x0", story_id: 1, platform: "x", audience_geo: "global", post_text: "no media",
        media_url: null, status: "APPROVED", scheduled_for: null, platform_post_id: null },
    ] });
    let called = false;
    const publishers = { x: async () => { called = true; return { platformPostId: "t", rawResponse: {} }; } };
    const res = await publishApprovedPosts({
      supabase: sb.client, publishers,
      getCreds: () => ({ consumerKey: "k" }),
      env: {},
    });
    assert.equal(called, false, "X must be gated once CONSTRAINTS.requiresMedia is true");
    assert.equal(res.skipped, 1);
    assert.equal(sb.byId.get("x0").status, "APPROVED");
  } finally {
    x.CONSTRAINTS.requiresMedia = original;
  }
});
