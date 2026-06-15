#!/usr/bin/env node
// Unit tests for the headline card path (reach: §8).
//
// Usage: node --test test/social-card.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderStoryCard } from "../lib/social/card-renderer.js";
import { createCardService } from "../lib/social/card-storage.js";
import { uploadMedia, publish } from "../lib/social/platforms/x.js";
import { generatePlatformPost } from "../lib/social/social-post-generator.js";
import * as x from "../lib/social/platforms/x.js";
import * as instagram from "../lib/social/platforms/instagram.js";
import * as facebook from "../lib/social/platforms/facebook.js";

const STORY = {
  id: 42,
  category_id: "finance",
  headline: "Markets rally as inflation cools to a three-year low",
  summary: "Stocks rose broadly after the latest inflation reading.",
  key_points: ["Indexes closed higher", "Yields eased"],
  source_count: 3,
};

// ── renderer ─────────────────────────────────────────────────────────────────

test("renderStoryCard: produces a PNG of the requested shape", async () => {
  const land = await renderStoryCard(STORY, { shape: "landscape" });
  assert.equal(land.contentType, "image/png");
  assert.deepEqual([land.width, land.height], [1600, 900]);
  // PNG magic number.
  assert.deepEqual([...land.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const sq = await renderStoryCard(STORY, { shape: "square" });
  assert.deepEqual([sq.width, sq.height], [1080, 1080]);
});

// ── card storage service ─────────────────────────────────────────────────────

function makeStorageMock() {
  const uploads = [];
  let created = null;
  const storage = {
    createBucket: async (name, opts) => { created = { name, opts }; return { error: null }; },
    from: () => ({
      upload: async (path, buffer, opts) => { uploads.push({ path, size: buffer.length, opts }); return { error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
    }),
  };
  return { supabase: { storage }, uploads, getCreated: () => created };
}

test("cardService.getCardUrl: renders, uploads, returns public URL; memoised", async () => {
  const mock = makeStorageMock();
  const svc = createCardService({ supabase: mock.supabase, env: {} });

  const url1 = await svc.getCardUrl({ story: STORY, shape: "landscape" });
  assert.equal(url1, "https://cdn.test/cards/42/landscape.png");
  assert.equal(mock.uploads.length, 1);
  assert.equal(mock.getCreated().opts.public, true);

  // Second call for the same (story, shape) is served from cache — no new upload.
  const url2 = await svc.getCardUrl({ story: STORY, shape: "landscape" });
  assert.equal(url2, url1);
  assert.equal(mock.uploads.length, 1);
});

test("cardService.getCardUrl: returns null (non-fatal) when upload fails", async () => {
  const supabase = {
    storage: {
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: async () => ({ error: { message: "boom" } }),
        getPublicUrl: () => ({ data: { publicUrl: "x" } }),
      }),
    },
  };
  const svc = createCardService({ supabase, env: {} });
  const url = await svc.getCardUrl({ story: STORY, shape: "square" });
  assert.equal(url, null);
});

// ── generator attaches media when a card service is supplied ──────────────────

test("generatePlatformPost: X stays TEXT-ONLY even when a cardService is present (no cardShape)", async () => {
  // X declares no cardShape, so the single-card branch never runs — even with
  // cards globally enabled, X must never attach an image (question-first strategy).
  const cardService = { getCardUrl: async ({ shape }) => `https://cdn.test/${shape}.png` };
  const post = await generatePlatformPost({ platform: x, story: STORY, audienceGeo: "global", cardService });
  assert.equal(post.mediaUrl, null);
});

test("generatePlatformPost: Instagram card clears requiresMedia", async () => {
  const cardService = { getCardUrl: async ({ shape }) => `https://cdn.test/${shape}.png` };
  const post = await generatePlatformPost({ platform: instagram, story: STORY, audienceGeo: "global", cardService });
  assert.equal(post.mediaUrl, "https://cdn.test/square.png");
  assert.equal(post.requiresMedia, false);
});

test("generatePlatformPost: Facebook renders a square JPEG card and clears requiresMedia", async () => {
  // FB's locked format is a single square card image + caption. With a cardService
  // present it requests shape=square format=jpeg and sets it on mediaUrl.
  const calls = [];
  const cardService = { getCardUrl: async ({ shape, format }) => { calls.push({ shape, format }); return `https://cdn.test/${shape}.${format}`; } };
  const post = await generatePlatformPost({ platform: facebook, story: STORY, audienceGeo: "global", cardService });
  assert.deepEqual(calls, [{ shape: "square", format: "jpeg" }]);
  assert.equal(post.mediaUrl, "https://cdn.test/square.jpeg");
  assert.equal(post.requiresMedia, false);
});

test("generatePlatformPost: no cardService → text-only draft (unchanged)", async () => {
  const post = await generatePlatformPost({ platform: x, story: STORY, audienceGeo: "global" });
  assert.equal(post.mediaUrl, null);
});

// ── X media upload + publish attach ──────────────────────────────────────────

const CREDS = { consumerKey: "k", consumerSecret: "ks", token: "t", tokenSecret: "tks" };

test("uploadMedia: posts multipart to v1.1 endpoint, returns media_id_string", async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ media_id_string: "12345" }) };
  };
  const id = await uploadMedia(Buffer.from([0x89, 0x50]), "image/png", { creds: CREDS, fetchImpl });
  assert.equal(id, "12345");
  assert.match(captured.url, /upload\.twitter\.com\/1\.1\/media\/upload\.json/);
  assert.match(captured.opts.headers["Content-Type"], /multipart\/form-data; boundary=/);
  assert.match(captured.opts.headers.Authorization, /^OAuth /);
});

test("publish: uploads media then attaches media_ids to the tweet", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (String(url).includes("cdn.test")) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
        headers: { get: () => "image/png" } };
    }
    if (String(url).includes("media/upload")) {
      return { ok: true, json: async () => ({ media_id_string: "999" }) };
    }
    return { ok: true, json: async () => ({ data: { id: "tweet-1" } }) };
  };

  const res = await publish(
    { post_text: "Markets rally. Take today's news quiz on Quydly", media_url: "https://cdn.test/card.png" },
    { creds: CREDS, fetchImpl }
  );

  assert.equal(res.platformPostId, "tweet-1");
  const tweetCall = calls.find((c) => String(c.url).includes("/2/tweets"));
  const sentBody = JSON.parse(tweetCall.opts.body);
  assert.deepEqual(sentBody.media, { media_ids: ["999"] });
});

test("publish: media fetch failure is non-fatal → text-only tweet still posts", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("cdn.test")) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
    return { ok: true, json: async () => ({ data: { id: "tweet-2" } }) };
  };
  const warns = [];
  const logger = { warn: (m) => warns.push(m) };
  const res = await publish(
    { post_text: "Hi Quydly", media_url: "https://cdn.test/bad.png" },
    { creds: CREDS, fetchImpl, logger }
  );
  assert.equal(res.platformPostId, "tweet-2");
  assert.ok(warns.some((w) => /x_media_attach_failed/.test(w)));
});
