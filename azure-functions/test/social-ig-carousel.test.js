#!/usr/bin/env node
// Unit tests for Instagram carousel publishing (tracker L4) — no network.
//
// Usage: node --test test/social-ig-carousel.test.js
//
// Covers: carousel renderer (4 JPEG slides) · slide storage (ordered URLs) ·
//         IG Graph publisher (creds, single, carousel, polling, dry-run, errors) ·
//         generator (carousel slides → social_media_assets rows) ·
//         publisher (IG ordered-slide fetch + per-platform creds skip).

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderCarouselSlides, CAROUSEL_SLIDES } from "../lib/social/card-renderer.js";
import { createCardService } from "../lib/social/card-storage.js";
import * as ig from "../lib/social/instagram-graph.js";
import { generatePlatformPost, generateSocialPosts } from "../lib/social/social-post-generator.js";
import * as instagram from "../lib/social/platforms/instagram.js";
import { publishApprovedPosts } from "../lib/social/social-publisher.js";

const STORY = {
  id: 99,
  category_id: "finance",
  headline: "Markets rally as inflation cools to a three-year low",
  summary: "Stocks rose broadly after the latest inflation reading. Investors now expect rate cuts.",
  key_points: ["Indexes closed higher", "Yields eased", "Rate-cut odds rose"],
};

const IG_CREDS = { igUserId: "17841400000000000", accessToken: "PAGE_TOKEN", graphVersion: "v21.0" };

// ── renderer ─────────────────────────────────────────────────────────────────

test("renderCarouselSlides: 4 ordered square JPEG slides (cover/what/why/cta)", async () => {
  const slides = await renderCarouselSlides(STORY);
  assert.equal(slides.length, 4);
  assert.deepEqual(slides.map((s) => s.slideType), CAROUSEL_SLIDES);
  slides.forEach((s, i) => {
    assert.equal(s.index, i);
    assert.equal(s.contentType, "image/jpeg");
    assert.deepEqual([s.width, s.height], [1080, 1080]);
    // JPEG SOI marker.
    assert.deepEqual([...s.buffer.subarray(0, 2)], [0xff, 0xd8]);
  });
});

// ── slide storage ──────────────────────────────────────────────────────────────

function makeStorageMock() {
  const uploads = [];
  const storage = {
    createBucket: async () => ({ error: null }),
    from: () => ({
      upload: async (path, buffer, opts) => { uploads.push({ path, size: buffer.length, opts }); return { error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
    }),
  };
  return { supabase: { storage }, uploads };
}

test("cardService.getCarouselSlideUrls: uploads each slide, returns ordered descriptors; memoised", async () => {
  const mock = makeStorageMock();
  const svc = createCardService({ supabase: mock.supabase, env: {} });

  const slides = await svc.getCarouselSlideUrls({ story: STORY });
  assert.equal(slides.length, 4);
  assert.deepEqual(slides.map((s) => s.index), [0, 1, 2, 3]);
  assert.equal(slides[0].url, "https://cdn.test/cards/99/carousel/0-cover.jpg");
  assert.equal(slides[3].url, "https://cdn.test/cards/99/carousel/3-cta.jpg");
  assert.equal(slides[0].contentType, "image/jpeg");
  assert.equal(mock.uploads.length, 4);
  assert.ok(mock.uploads.every((u) => /\.jpg$/.test(u.path)));

  // Second call is served from cache — no new uploads.
  const again = await svc.getCarouselSlideUrls({ story: STORY });
  assert.equal(again, slides);
  assert.equal(mock.uploads.length, 4);
});

test("cardService.getCarouselSlideUrls: returns null (non-fatal) when an upload fails", async () => {
  const supabase = {
    storage: {
      createBucket: async () => ({ error: null }),
      from: () => ({ upload: async () => ({ error: { message: "boom" } }), getPublicUrl: () => ({ data: { publicUrl: "x" } }) }),
    },
  };
  const svc = createCardService({ supabase, env: {} });
  assert.equal(await svc.getCarouselSlideUrls({ story: STORY }), null);
});

// ── IG Graph publisher ──────────────────────────────────────────────────────────

test("credsFromEnv: throws listing every missing var; defaults graph version", () => {
  assert.throws(() => ig.credsFromEnv({}), /INSTAGRAM_BUSINESS_ACCOUNT_ID.*META_PAGE_ACCESS_TOKEN/);
  const c = ig.credsFromEnv({ INSTAGRAM_BUSINESS_ACCOUNT_ID: "1", META_PAGE_ACCESS_TOKEN: "t" });
  assert.equal(c.graphVersion, "v21.0");
});

test("publish: single image → one container then media_publish", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes("/media_publish")) return { ok: true, json: async () => ({ id: "IG_MEDIA_1" }) };
    if (String(url).includes("/media")) return { ok: true, json: async () => ({ id: "CONTAINER_1" }) };
    return { ok: true, json: async () => ({ status_code: "FINISHED" }) };
  };
  const res = await ig.publish(
    { post_text: "caption", media_url: "https://cdn.test/card.jpg" },
    { creds: IG_CREDS, fetchImpl }
  );
  assert.equal(res.platformPostId, "IG_MEDIA_1");
  // create container carries the caption + image_url; no carousel fields.
  const create = calls.find((c) => c.url.includes("/media") && !c.url.includes("media_publish"));
  assert.match(create.opts.body, /image_url=https/);
  assert.match(create.opts.body, /caption=caption/);
  assert.doesNotMatch(create.opts.body, /media_type=CAROUSEL/);
});

test("publish: carousel → N child containers + CAROUSEL parent + publish, polled to FINISHED", async () => {
  const created = [];
  let polls = 0;
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    if (u.includes("/media_publish")) return { ok: true, json: async () => ({ id: "IG_CAROUSEL_MEDIA" }) };
    if (u.includes("?fields=status_code")) {
      polls++;
      return { ok: true, json: async () => ({ status_code: polls < 2 ? "IN_PROGRESS" : "FINISHED" }) };
    }
    if (u.includes("/media")) { created.push(opts.body); return { ok: true, json: async () => ({ id: `C${created.length}` }) }; }
    throw new Error("unexpected " + u);
  };
  const slides = [
    { url: "https://cdn.test/0.jpg" }, { url: "https://cdn.test/1.jpg" },
    { url: "https://cdn.test/2.jpg" }, { url: "https://cdn.test/3.jpg" },
  ];
  const res = await ig.publish(
    { post_text: "cap" },
    { creds: IG_CREDS, slides, fetchImpl, sleepImpl: async () => {} }
  );
  assert.equal(res.platformPostId, "IG_CAROUSEL_MEDIA");
  // 4 child containers (is_carousel_item) + 1 parent (CAROUSEL with children).
  assert.equal(created.length, 5);
  assert.equal(created.filter((b) => /is_carousel_item=true/.test(b)).length, 4);
  const parent = created.find((b) => /media_type=CAROUSEL/.test(b));
  assert.ok(parent);
  assert.match(parent, /children=C1%2CC2%2CC3%2CC4/); // url-encoded "C1,C2,C3,C4"
  assert.match(parent, /caption=cap/);
  assert.ok(polls >= 2); // waited for FINISHED
});

test("publish dryRun: assembles + logs, calls no endpoint, returns DRYRUN id", async () => {
  let fetched = false;
  const logs = [];
  const logger = Object.assign((m) => logs.push(m), { warn: () => {}, error: () => {} });
  const slides = [{ url: "https://cdn.test/0.jpg" }, { url: "https://cdn.test/1.jpg" }];
  const res = await ig.publish(
    { post_text: "cap" },
    { creds: IG_CREDS, slides, fetchImpl: async () => { fetched = true; }, logger, dryRun: true }
  );
  assert.equal(fetched, false);
  assert.match(res.platformPostId, /^DRYRUN-2-carousel/);
  assert.ok(logs.some((l) => /ig_publish_dry_run/.test(l)));
});

test("publish: rejects non-HTTPS image url and a no-image post", async () => {
  await assert.rejects(
    () => ig.publish({ media_url: "http://insecure/x.jpg" }, { creds: IG_CREDS, fetchImpl: async () => ({}) }),
    /public HTTPS/
  );
  await assert.rejects(() => ig.publish({ post_text: "x" }, { creds: IG_CREDS, fetchImpl: async () => ({}) }), /no image url/);
});

test("publish: surfaces a Graph API error with Meta's message", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid image" } }) });
  await assert.rejects(
    () => ig.publish({ media_url: "https://cdn.test/x.jpg" }, { creds: IG_CREDS, fetchImpl }),
    /Instagram Graph 400: Invalid image/
  );
});

test("waitForContainer: throws when status_code is ERROR", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ status_code: "ERROR", status: "bad" }) });
  await assert.rejects(
    () => ig.waitForContainer({ creds: IG_CREDS, containerId: "C9", fetchImpl, sleepImpl: async () => {} }),
    /status=ERROR/
  );
});

// ── generator: carousel slides become ordered asset rows ────────────────────────

test("generatePlatformPost: IG carousel attaches slides + cover media_url when enabled", async () => {
  const cardService = {
    getCarouselSlideUrls: async ({ story }) => [
      { url: `https://cdn.test/${story.id}/0.jpg`, index: 0, slideType: "cover", width: 1080, height: 1080 },
      { url: `https://cdn.test/${story.id}/1.jpg`, index: 1, slideType: "what", width: 1080, height: 1080 },
    ],
    getCardUrl: async () => "https://cdn.test/should-not-be-used.jpg",
  };
  const post = await generatePlatformPost({ platform: instagram, story: STORY, audienceGeo: "global", cardService, igCarousel: true });
  assert.equal(post.carouselSlides.length, 2);
  assert.equal(post.mediaUrl, "https://cdn.test/99/0.jpg"); // cover
  assert.equal(post.requiresMedia, false);
});

test("generatePlatformPost: IG without carousel flag falls back to a single JPEG card", async () => {
  let askedShape, askedFormat;
  const cardService = {
    getCardUrl: async ({ shape, format }) => { askedShape = shape; askedFormat = format; return "https://cdn.test/sq.jpg"; },
  };
  const post = await generatePlatformPost({ platform: instagram, story: STORY, audienceGeo: "global", cardService, igCarousel: false });
  assert.equal(post.mediaUrl, "https://cdn.test/sq.jpg");
  assert.equal(askedShape, "square");
  assert.equal(askedFormat, "jpeg"); // IG single card must be JPEG too
  assert.equal(post.carouselSlides, undefined);
});

// Mock Supabase capturing inserts into social_posts + social_media_assets.
function makeGenSupabase({ candidateStatus = "PENDING" } = {}) {
  const assets = [];
  const posts = [];
  let seq = 0;
  const client = {
    from(table) {
      const q = { table, _eq: {}, _payload: null };
      q.select = () => q;
      q.eq = (k, v) => { q._eq[k] = v; return q; };
      q.upsert = (payload) => { q._payload = payload; return q; };
      q.update = (payload) => { q._op = "update"; q._payload = payload; return q; };
      q.maybeSingle = async () => {
        if (q.table === "social_publication_candidates") {
          return { data: { id: "cand-1", story_id: STORY.id, audience_geo: "global", status: candidateStatus }, error: null };
        }
        if (q.table === "stories") return { data: STORY, error: null };
        if (q.table === "social_posts") {
          if (q._op === "update") return { data: null, error: null };
          if (q._payload) { // upsert insert
            const row = { id: `post-${++seq}`, ...q._payload };
            posts.push(row);
            return { data: { id: row.id }, error: null };
          }
          return { data: null, error: null }; // existing check → none
        }
        return { data: null, error: null };
      };
      // social_media_assets upsert resolves as a thenable (no maybeSingle).
      q.then = (res, rej) => {
        if (q.table === "social_media_assets" && q._payload) assets.push(...q._payload);
        return Promise.resolve({ error: null }).then(res, rej);
      };
      return q;
    },
  };
  return { client, assets, posts };
}

test("generateSocialPosts: AUTO_APPROVED + carousel media → IG post APPROVED (auto-publishes)", async () => {
  const sb = makeGenSupabase({ candidateStatus: "AUTO_APPROVED" });
  const cardService = {
    getCardUrl: async ({ shape }) => `https://cdn.test/card-${shape}.png`,
    getCarouselSlideUrls: async () => [
      { url: "https://cdn.test/0.jpg", index: 0, slideType: "cover", width: 1080, height: 1080 },
      { url: "https://cdn.test/1.jpg", index: 1, slideType: "what", width: 1080, height: 1080 },
    ],
  };
  await generateSocialPosts({ supabase: sb.client, cardService, igCarousel: true, candidateId: "cand-1" });
  const ig = sb.posts.find((p) => p.platform === "instagram");
  assert.equal(ig.status, "APPROVED");          // has carousel media → eligible to auto-publish
  assert.equal(ig.media_url, "https://cdn.test/0.jpg");
});

test("generateSocialPosts: AUTO_APPROVED but NO media → IG stays PENDING_REVIEW", async () => {
  const sb = makeGenSupabase({ candidateStatus: "AUTO_APPROVED" });
  // No cardService → IG draft has no media_url.
  await generateSocialPosts({ supabase: sb.client, candidateId: "cand-1" });
  const ig = sb.posts.find((p) => p.platform === "instagram");
  assert.equal(ig.status, "PENDING_REVIEW");
  assert.equal(sb.posts.find((p) => p.platform === "x").status, "APPROVED"); // X still auto-approves
});

test("generateSocialPosts: carousel slides persist as ordered instagram_carousel_slide rows", async () => {
  const sb = makeGenSupabase();
  const cardService = {
    getCardUrl: async ({ shape }) => `https://cdn.test/card-${shape}.png`, // X/FB single cards
    getCarouselSlideUrls: async () => [
      { url: "https://cdn.test/0.jpg", index: 0, slideType: "cover", width: 1080, height: 1080 },
      { url: "https://cdn.test/1.jpg", index: 1, slideType: "what", width: 1080, height: 1080 },
      { url: "https://cdn.test/2.jpg", index: 2, slideType: "why", width: 1080, height: 1080 },
      { url: "https://cdn.test/3.jpg", index: 3, slideType: "cta", width: 1080, height: 1080 },
    ],
  };
  await generateSocialPosts({ supabase: sb.client, cardService, igCarousel: true, candidateId: "cand-1" });

  // Only the Instagram post produces carousel assets.
  assert.equal(sb.assets.length, 4);
  assert.deepEqual(sb.assets.map((a) => a.position), [0, 1, 2, 3]);
  assert.ok(sb.assets.every((a) => a.asset_type === "instagram_carousel_slide"));
  assert.ok(sb.assets.every((a) => a.format === "jpeg"));
  assert.ok(sb.assets.every((a) => a.social_post_id));
});

// ── publisher: IG ordered-slide fetch + creds-skip ──────────────────────────────

function makePubSupabase({ duePosts, slidesByPost = {}, counts = {} }) {
  const byId = new Map(duePosts.map((p) => [p.id, { ...p }]));
  function from(table) {
    const q = { table, filters: {}, payload: null, count: false, single: false };
    q.select = (_c, opts) => { if (opts && opts.head) q.count = true; return q; };
    q.update = (p) => { q.op = "update"; q.payload = p; return q; };
    q.eq = (k, v) => { q.filters[k] = v; return q; };
    q.in = (k, v) => { q.filters[`in_${k}`] = v; return q; };
    q.is = (k, v) => { q.filters[`is_${k}`] = v; return q; };
    q.or = () => q; q.gte = () => q; q.lte = () => q; q.order = () => q; q.limit = () => q;
    q.maybeSingle = () => { q.single = true; return resolve(q); };
    q.then = (res, rej) => resolve(q).then(res, rej);
    return q;
  }
  async function resolve(q) {
    if (q.table === "social_media_assets") {
      return { data: slidesByPost[q.filters.social_post_id] || [], error: null };
    }
    if (q.op === "update") {
      const post = byId.get(q.filters.id);
      if (q.single) {
        const ok = post && post.platform_post_id == null && ["APPROVED", "SCHEDULED"].includes(post.status);
        if (ok) { post.status = "PUBLISHING"; return { data: { id: post.id }, error: null }; }
        return { data: null, error: null };
      }
      if (post) Object.assign(post, q.payload);
      return { error: null };
    }
    if (q.count) return { count: counts[q.filters.platform] || 0, error: null };
    return { data: duePosts, error: null };
  }
  return { client: { from }, byId };
}

const igPost = (id, over = {}) => ({
  id, story_id: 1, platform: "instagram", audience_geo: "global", post_text: "cap",
  media_url: "https://cdn.test/0.jpg", status: "APPROVED", scheduled_for: null, platform_post_id: null, ...over,
});

test("publishApprovedPosts: IG post publishes with its ordered slides", async () => {
  const sb = makePubSupabase({
    duePosts: [igPost("ig1")],
    slidesByPost: { ig1: [
      { asset_url: "https://cdn.test/2.jpg", position: 2 },
      { asset_url: "https://cdn.test/0.jpg", position: 0 },
      { asset_url: "https://cdn.test/1.jpg", position: 1 },
    ] },
  });
  let received;
  const publishers = { instagram: async (post, { slides }) => { received = slides; return { platformPostId: "IGM1", rawResponse: {} }; } };
  const res = await publishApprovedPosts({
    supabase: sb.client, publishers, getIgCreds: () => IG_CREDS, env: {},
  });
  assert.equal(res.published, 1);
  // The publisher passes the slides as the DB returned them (ordered by position in prod).
  assert.equal(received.length, 3);
  assert.ok(received.every((s) => s.url));
  assert.equal(sb.byId.get("ig1").status, "POSTED");
  assert.equal(sb.byId.get("ig1").platform_post_id, "IGM1");
});

test("publishApprovedPosts: missing IG creds → release claim + skip (does not throw)", async () => {
  const sb = makePubSupabase({ duePosts: [igPost("ig2")] });
  let called = false;
  const publishers = { instagram: async () => { called = true; return { platformPostId: "x", rawResponse: {} }; } };
  const res = await publishApprovedPosts({
    supabase: sb.client, publishers,
    getIgCreds: () => { throw new Error("Instagram Graph creds missing"); },
    env: {},
  });
  assert.equal(called, false);
  assert.equal(res.skipped, 1);
  assert.equal(res.published, 0);
  assert.equal(sb.byId.get("ig2").status, "APPROVED"); // released back
});
