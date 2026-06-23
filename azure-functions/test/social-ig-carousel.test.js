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

import { renderCarouselSlides, CAROUSEL_SLIDES, coverDateLine } from "../lib/social/card-renderer.js";
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

// A story whose lead entity is a person with a licensed Wikipedia portrait.
const STORY_PERSON = {
  ...STORY,
  primary_entities_enriched: [
    {
      name: "Jane Doe", type: "person",
      wikipedia_thumbnail_url: "https://upload.wikimedia.org/jane.png",
      image_license: "Wikipedia: see source page",
    },
  ],
};

// Smallest valid PNG (1×1) — enough for Satori to decode dimensions when it
// embeds the portrait data URI. Returned by the fake image fetch below.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
function imgResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? "image/png" : null) },
    arrayBuffer: async () => PNG_1x1.buffer.slice(PNG_1x1.byteOffset, PNG_1x1.byteOffset + PNG_1x1.byteLength),
  };
}

// ── renderer ─────────────────────────────────────────────────────────────────

test("renderCarouselSlides: no whyItMatters → 4 slides (cover/what/keypoints/cta)", async () => {
  const slides = await renderCarouselSlides(STORY);
  assert.equal(slides.length, 4);
  assert.deepEqual(slides.map((s) => s.slideType), ["cover", "what", "keypoints", "cta"]);
  slides.forEach((s, i) => {
    assert.equal(s.index, i);
    assert.equal(s.contentType, "image/jpeg");
    assert.deepEqual([s.width, s.height], [1080, 1350]);
    // JPEG SOI marker.
    assert.deepEqual([...s.buffer.subarray(0, 2)], [0xff, 0xd8]);
  });
});

test("renderCarouselSlides: whyItMatters (no question) → 5 slides with a separate Why it matters slide, no engagement slide", async () => {
  // The full CAROUSEL_SLIDES set now also includes "engagement", but with no
  // question supplied that slide is dropped — so the rendered set is the 5-slide
  // why-included carousel WITHOUT engagement (CAROUSEL_SLIDES minus engagement).
  const slides = await renderCarouselSlides(STORY, { whyItMatters: ["Third cut since 2023", "Echoes the 2019 stimulus"] });
  assert.equal(slides.length, 5);
  assert.deepEqual(slides.map((s) => s.slideType), CAROUSEL_SLIDES.filter((k) => k !== "engagement"));
  assert.deepEqual(slides.map((s) => s.slideType), ["cover", "what", "keypoints", "why", "cta"]);
  slides.forEach((s, i) => {
    assert.equal(s.index, i);
    assert.deepEqual([...s.buffer.subarray(0, 2)], [0xff, 0xd8]); // valid JPEG
  });
});

test("coverDateLine: formats published_at as an IST (Asia/Kolkata) day", async () => {
  // Mid-day UTC, comfortably inside the same IST day: 09:30Z → 15:00 IST on
  // 2026-06-02 (a Tuesday). Style is en-GB with the brand middot separator.
  assert.equal(
    coverDateLine({ published_at: "2026-06-02T09:30:00.000Z" }),
    "Tuesday · 2 June 2026"
  );
});

test("coverDateLine: late-UTC timestamp rolls forward to the next IST day", async () => {
  // 2026-06-02T20:00:00Z is Tuesday 2 June in UTC, but +05:30 pushes it to
  // 2026-06-03T01:30 IST → Wednesday 3 June. This proves the IST offset is
  // applied (UTC would have rendered "Tuesday · 2 June 2026").
  assert.equal(
    coverDateLine({ published_at: "2026-06-02T20:00:00.000Z" }),
    "Wednesday · 3 June 2026"
  );
});

test("coverDateLine: missing/invalid published_at → empty (headline-only cover)", async () => {
  assert.equal(coverDateLine({}), "");
  assert.equal(coverDateLine({ published_at: "not-a-date" }), "");
  assert.equal(coverDateLine(null), "");
});

test("renderCarouselSlides: cover renders an IST date line when published_at is set", async () => {
  // published_at mid-day UTC → "Tuesday · 2 June 2026" in IST. We assert it still
  // produces a valid JPEG cover (exercises the dated cover branch).
  const dated = { ...STORY, published_at: "2026-06-02T09:30:00.000Z" };
  const slides = await renderCarouselSlides(dated);
  assert.equal(slides.length, 4);
  assert.deepEqual([...slides[0].buffer.subarray(0, 2)], [0xff, 0xd8]); // cover JPEG
});

test("renderCarouselSlides: missing/invalid published_at → cover renders headline-only", async () => {
  // No date and a bogus date both fall back to the bare-headline cover.
  for (const story of [STORY, { ...STORY, published_at: "not-a-date" }]) {
    const slides = await renderCarouselSlides(story);
    assert.deepEqual([...slides[0].buffer.subarray(0, 2)], [0xff, 0xd8]);
  }
});

// ── renderer: lead-person portrait on the cover (L4 portrait feature) ──────────

test("renderCarouselSlides: withPortrait fetches the lead person's licensed photo; still 4 JPEG slides", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return imgResponse(); };
  const slides = await renderCarouselSlides(STORY_PERSON, { withPortrait: true, fetchImpl });
  assert.equal(slides.length, 4);
  assert.deepEqual(slides.map((s) => s.slideType), ["cover", "what", "keypoints", "cta"]);
  slides.forEach((s) => assert.deepEqual([...s.buffer.subarray(0, 2)], [0xff, 0xd8])); // valid JPEGs
  assert.deepEqual(calls, ["https://upload.wikimedia.org/jane.png"]); // fetched exactly the portrait
});

test("renderCarouselSlides: portrait disabled by default → no fetch even with a person", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return imgResponse(); };
  const slides = await renderCarouselSlides(STORY_PERSON, { fetchImpl }); // withPortrait omitted
  assert.equal(called, false);
  assert.equal(slides.length, 4);
});

test("renderCarouselSlides: withPortrait but no person entity → no fetch, text-only cover", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return imgResponse(); };
  const slides = await renderCarouselSlides(STORY, { withPortrait: true, fetchImpl });
  assert.equal(called, false);
  assert.equal(slides.length, 4);
});

test("renderCarouselSlides: an org/place lead image is used on the cover (no lead person)", async () => {
  // With no person entity, the cover falls back to the first org/place image so
  // non-person stories aren't bland — the wrong-face risk doesn't apply to logos
  // or landmarks.
  const story = { ...STORY, primary_entities_enriched: [
    { name: "Acme Corp", type: "org", wikipedia_thumbnail_url: "https://upload.wikimedia.org/acme.png" },
  ] };
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return imgResponse(); };
  const slides = await renderCarouselSlides(story, { withPortrait: true, fetchImpl });
  assert.deepEqual(calls, ["https://upload.wikimedia.org/acme.png"]); // org image fetched
  assert.equal(slides.length, 4);
});

test("renderCarouselSlides: a lead person image wins over a later org image (cover)", async () => {
  const story = { ...STORY, primary_entities_enriched: [
    { name: "Jane Doe", type: "person", wikipedia_thumbnail_url: "https://upload.wikimedia.org/jane.png" },
    { name: "Acme Corp", type: "org", wikipedia_thumbnail_url: "https://upload.wikimedia.org/acme.png" },
  ] };
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return imgResponse(); };
  await renderCarouselSlides(story, { slides: ["cover"], withPortrait: true, fetchImpl });
  assert.deepEqual(calls, ["https://upload.wikimedia.org/jane.png"]); // person preferred on cover
});

test("renderCarouselSlides: body slides get OTHER story entities' images (real imagery, not text)", async () => {
  const story = { ...STORY, primary_entities_enriched: [
    { name: "Jane Doe", type: "person", wikipedia_thumbnail_url: "https://upload.wikimedia.org/jane.png" },
    { name: "Acme Corp", type: "org", wikipedia_thumbnail_url: "https://upload.wikimedia.org/acme.png" },
  ] };
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return imgResponse(); };
  // cover + what + keypoints → cover uses the person, a body slide uses the org.
  await renderCarouselSlides(story, { slides: ["cover", "what", "keypoints"], withPortrait: true, fetchImpl });
  assert.ok(calls.includes("https://upload.wikimedia.org/jane.png")); // cover (person)
  assert.ok(calls.includes("https://upload.wikimedia.org/acme.png")); // body slide (org)
});

test("renderCarouselSlides: cover hook + highlight renders a valid JPEG in both modes", async () => {
  // Exercises the word-level highlight layout: a multi-word highlight span that
  // matches the hook is emphasised; both render modes must produce a valid cover.
  for (const highlightMode of ["marker", "accent"]) {
    const slides = await renderCarouselSlides(STORY, {
      slides: ["cover"],
      coverHook: "Oracle cut 21,000 jobs in a year",
      coverHighlight: "21,000 jobs",
      highlightMode,
    });
    assert.equal(slides.length, 1);
    assert.equal(slides[0].slideType, "cover");
    assert.deepEqual([...slides[0].buffer.subarray(0, 2)], [0xff, 0xd8]); // JPEG SOI
  }
});

test("renderCarouselSlides: a highlight that doesn't match the hook still renders (no emphasis, no throw)", async () => {
  const slides = await renderCarouselSlides(STORY, {
    slides: ["cover"],
    coverHook: "Markets rally as inflation cools",
    coverHighlight: "not in the hook at all",
  });
  assert.equal(slides.length, 1);
  assert.deepEqual([...slides[0].buffer.subarray(0, 2)], [0xff, 0xd8]);
});

test("renderCarouselSlides: lead person has no photo → text-only cover even if a LATER person does", async () => {
  // First person entity is the lead subject; it has no portrait. A later person
  // entity does — but we must NOT fall through to it (that put the wrong face on
  // the cover). Expect no fetch at all and a text-only cover.
  const story = { ...STORY, primary_entities_enriched: [
    { name: "Lead Person", type: "person" }, // no portrait_* / wikipedia_thumbnail_url
    { name: "Other Person", type: "person", wikipedia_thumbnail_url: "https://upload.wikimedia.org/other.png" },
  ] };
  let called = false;
  const fetchImpl = async () => { called = true; return imgResponse(); };
  // Render the cover in isolation: the cover must never fetch a later person's
  // face (the no-wrong-face guard). Captioned later-entity images may still
  // appear on BODY slides — that's covered separately.
  const slides = await renderCarouselSlides(story, { slides: ["cover"], withPortrait: true, fetchImpl });
  assert.equal(called, false); // cover never fetched the later person's photo
  assert.equal(slides.length, 1);
  assert.deepEqual([...slides[0].buffer.subarray(0, 2)], [0xff, 0xd8]); // cover still a valid JPEG
});

test("renderCarouselSlides: no entity image → brand-graphic floor, every slide still a valid JPEG", async () => {
  // A story with no licensed entity image must never render bare text: the cover
  // and body slides fall back to the designed brand graphic (no fetch needed).
  const story = { ...STORY, primary_entities_enriched: [{ name: "Some Org", type: "org" }] };
  let called = false;
  const fetchImpl = async () => { called = true; return imgResponse(); };
  const slides = await renderCarouselSlides(story, {
    slides: ["cover", "what", "keypoints"], withPortrait: true,
    coverHook: "City exam glitch stranded thousands of students", coverHighlight: "exam glitch", fetchImpl,
  });
  assert.equal(called, false); // no image to fetch — floor is procedural
  assert.equal(slides.length, 3);
  for (const s of slides) assert.deepEqual([...s.buffer.subarray(0, 2)], [0xff, 0xd8]); // valid JPEGs
});

test("renderCarouselSlides: non-HTTPS portrait url is skipped (no fetch)", async () => {
  const story = { ...STORY, primary_entities_enriched: [
    { name: "Jane Doe", type: "person", wikipedia_thumbnail_url: "http://insecure/jane.png" },
  ] };
  let called = false;
  const fetchImpl = async () => { called = true; return imgResponse(); };
  await renderCarouselSlides(story, { withPortrait: true, fetchImpl });
  assert.equal(called, false);
});

test("renderCarouselSlides: editor portrait override wins over Wikipedia thumbnail", async () => {
  const story = { ...STORY, primary_entities_enriched: [
    {
      name: "Jane Doe", type: "person", portrait_source: "override",
      portrait_image_url: "https://cdn.test/press/jane.png",
      portrait_attribution: "AP Photo/Jane", portrait_license: "AP",
      wikipedia_thumbnail_url: "https://upload.wikimedia.org/jane.png",
    },
  ] };
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return imgResponse(); };
  await renderCarouselSlides(story, { withPortrait: true, fetchImpl });
  assert.deepEqual(calls, ["https://cdn.test/press/jane.png"]); // override, not the wiki thumb
});

test("renderCarouselSlides: portrait fetch failure falls back to a text-only cover", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
  const slides = await renderCarouselSlides(STORY_PERSON, { withPortrait: true, fetchImpl });
  assert.equal(slides.length, 4);
  assert.deepEqual([...slides[0].buffer.subarray(0, 2)], [0xff, 0xd8]); // cover still a valid JPEG
});

test("renderCarouselSlides: oversize portrait (content-length over cap) → text-only cover", async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (h) => {
      const k = String(h).toLowerCase();
      if (k === "content-type") return "image/png";
      if (k === "content-length") return String(50 * 1024 * 1024); // 50 MB, over the 6 MB cap
      return null;
    } },
    arrayBuffer: async () => PNG_1x1.buffer.slice(0),
  });
  const slides = await renderCarouselSlides(STORY_PERSON, { withPortrait: true, fetchImpl });
  assert.equal(slides.length, 4);
  assert.deepEqual([...slides[0].buffer.subarray(0, 2)], [0xff, 0xd8]); // cover still a valid JPEG
});

test("renderCarouselSlides: non-image content-type is rejected (text-only cover)", async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? "text/html" : null) },
    arrayBuffer: async () => PNG_1x1.buffer.slice(0),
  });
  const slides = await renderCarouselSlides(STORY_PERSON, { withPortrait: true, fetchImpl });
  assert.equal(slides.length, 4);
});

// ── renderer: engagement slide (MCQ from the previous post's story) ────────────

const ENGAGEMENT_Q = {
  question: "What did the central bank do?",
  options: ["Cut rates", "Raised rates", "Held rates", "Paused QT"],
  correctIndex: 0,
};

test("renderCarouselSlides: question → engagement slide inserted SECOND-TO-LAST (before cta)", async () => {
  const slides = await renderCarouselSlides(STORY, { question: ENGAGEMENT_Q });
  assert.deepEqual(slides.map((s) => s.slideType), ["cover", "what", "keypoints", "engagement", "cta"]);
  slides.forEach((s, i) => {
    assert.equal(s.index, i);
    assert.deepEqual([...s.buffer.subarray(0, 2)], [0xff, 0xd8]); // valid JPEG
  });
});

test("renderCarouselSlides: question + whyItMatters → engagement still sits before cta", async () => {
  const slides = await renderCarouselSlides(STORY, { whyItMatters: ["Third cut since 2023"], question: ENGAGEMENT_Q });
  assert.deepEqual(slides.map((s) => s.slideType), ["cover", "what", "keypoints", "why", "engagement", "cta"]);
});

test("renderCarouselSlides: no question → no engagement slide (silent fallback)", async () => {
  const slides = await renderCarouselSlides(STORY);
  assert.ok(!slides.some((s) => s.slideType === "engagement"));
  assert.deepEqual(slides.map((s) => s.slideType), ["cover", "what", "keypoints", "cta"]);
});

test("renderCarouselSlides: malformed question (3 options) → engagement slide dropped", async () => {
  const slides = await renderCarouselSlides(STORY, { question: { question: "q", options: ["a", "b", "c"], correctIndex: 0 } });
  assert.ok(!slides.some((s) => s.slideType === "engagement"));
  assert.equal(slides.length, 4);
});

// ── platform: generateEngagementQuestion (sources from previous POSTED IG post) ─

test("instagram.generateEngagementQuestion: pulls prev POSTED IG story, returns MCQ + sourcePostId", async () => {
  // STORY (today) has no entities → the topical-overlap gate cannot apply, so we
  // fall back to the most recent same-category post (pre-fix behaviour).
  const PREV_STORY = { id: 7, headline: "Bank cut rates", summary: "The bank cut rates.", key_points: ["Rates fell"], category_id: "finance" };
  const queries = [];
  const supabase = {
    from(table) {
      const q = { table, _eq: {}, _calls: [] };
      q.select = () => q;
      q.eq = (k, v) => { q._eq[k] = v; return q; };
      q.not = () => q; q.neq = (k, v) => { q._eq[`neq_${k}`] = v; return q; };
      q.order = () => q;
      q.limit = async () => {
        queries.push({ table, eq: q._eq });
        // Embedded !inner join: the prev story rides on the social_posts row.
        if (table === "social_posts") return { data: [{ id: "prev-post-1", published_at: "2026-06-20T00:00:00Z", stories: PREV_STORY }], error: null };
        return { data: [], error: null };
      };
      return q;
    },
  };
  const anthropic = {
    messages: { create: async () => ({ content: [{ text: JSON.stringify({ question: "What happened to rates?", options: ["Cut", "Raised", "Held", "Paused"], correctIndex: 0 }) }] }) },
  };
  const out = await instagram.generateEngagementQuestion({ anthropic, supabase, story: STORY, audienceGeo: "global" });
  assert.equal(out.question, "What happened to rates?");
  assert.equal(out.options.length, 4);
  assert.equal(out.correctIndex, 0);
  assert.equal(out.answer, "Cut");
  assert.equal(out.sourcePostId, "prev-post-1");
  // Sourced from the prev IG POSTED post in the SAME category, excluding the current story id.
  const postQ = queries.find((x) => x.table === "social_posts");
  assert.equal(postQ.eq.platform, "instagram");
  assert.equal(postQ.eq.status, "POSTED");
  assert.equal(postQ.eq["stories.category_id"], STORY.category_id);
  assert.equal(postQ.eq.neq_story_id, STORY.id);
});

test("instagram.generateEngagementQuestion: no previous post → null (no engagement slide)", async () => {
  const supabase = {
    from() {
      const q = {};
      q.select = () => q; q.eq = () => q; q.not = () => q; q.neq = () => q; q.order = () => q;
      q.limit = async () => ({ data: [], error: null });
      return q;
    },
  };
  const anthropic = { messages: { create: async () => { throw new Error("should not be called"); } } };
  const out = await instagram.generateEngagementQuestion({ anthropic, supabase, story: STORY, audienceGeo: "global" });
  assert.equal(out, null);
});

// Topical-relevance gate: when today's story HAS entities, the prior post must
// share ≥1 of them — a same-category-but-unrelated post (the Iran-post-asks-an-
// IPL-question bug) is rejected and the slide is dropped.
test("instagram.generateEngagementQuestion: same category but no shared entity → null", async () => {
  const TODAY = { ...STORY, id: 99, category_id: "world", primary_entities: ["Iran", "Pakistan"] };
  const CRICKET = { id: 7, headline: "Pant traded to Delhi", summary: "An IPL trade.", key_points: ["Pant moved"], category_id: "world", primary_entities: ["Rishabh Pant", "Delhi Capitals"] };
  const supabase = {
    from() {
      const q = {};
      q.select = () => q; q.eq = () => q; q.not = () => q; q.neq = () => q; q.order = () => q;
      q.limit = async () => ({ data: [{ id: "prev-cricket", published_at: "2026-06-20T00:00:00Z", stories: CRICKET }], error: null });
      return q;
    },
  };
  const anthropic = { messages: { create: async () => { throw new Error("should not be called"); } } };
  const out = await instagram.generateEngagementQuestion({ anthropic, supabase, story: TODAY, audienceGeo: "global" });
  assert.equal(out, null);
});

// When a topically-related prior post exists deeper in the list, it is preferred
// over a newer-but-unrelated one in the same category.
test("instagram.generateEngagementQuestion: skips newer unrelated post, picks the related one", async () => {
  const TODAY = { ...STORY, id: 99, category_id: "world", primary_entities: ["Iran", "Pakistan"] };
  const CRICKET = { id: 7, headline: "Pant traded", summary: "An IPL trade.", key_points: ["Pant moved"], category_id: "world", primary_entities: ["Rishabh Pant"] };
  const IRAN = { id: 8, headline: "Iran met Pakistan", summary: "Talks were held.", key_points: ["Talks held"], category_id: "world", primary_entities: ["Iran", "Switzerland"] };
  const supabase = {
    from() {
      const q = {};
      q.select = () => q; q.eq = () => q; q.not = () => q; q.neq = () => q; q.order = () => q;
      q.limit = async () => ({ data: [
        { id: "post-cricket", published_at: "2026-06-21T00:00:00Z", stories: CRICKET }, // newer, unrelated
        { id: "post-iran", published_at: "2026-06-20T00:00:00Z", stories: IRAN },       // older, shares "Iran"
      ], error: null });
      return q;
    },
  };
  const anthropic = {
    messages: { create: async () => ({ content: [{ text: JSON.stringify({ question: "What did Iran do?", options: ["Met Pakistan", "Left the UN", "Raised rates", "Won a match"], correctIndex: 0 }) }] }) },
  };
  const out = await instagram.generateEngagementQuestion({ anthropic, supabase, story: TODAY, audienceGeo: "global" });
  assert.equal(out.sourcePostId, "post-iran");
  assert.equal(out.answer, "Met Pakistan");
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
  // No why / no question / no hook → "nowhy-noq-nohook" variant segment in the path.
  assert.equal(slides[0].url, "https://cdn.test/cards/99/carousel/nowhy-noq-nohook-noill/0-cover.jpg");
  assert.equal(slides[3].url, "https://cdn.test/cards/99/carousel/nowhy-noq-nohook-noill/3-cta.jpg");
  assert.equal(slides[0].contentType, "image/jpeg");
  assert.equal(mock.uploads.length, 4);
  assert.ok(mock.uploads.every((u) => /\.jpg$/.test(u.path)));

  // Second call is served from cache — no new uploads.
  const again = await svc.getCarouselSlideUrls({ story: STORY });
  assert.equal(again, slides);
  assert.equal(mock.uploads.length, 4);
});

test("cardService.getCarouselSlideUrls: distinct engagement questions get distinct storage paths (no overwrite)", async () => {
  const mock = makeStorageMock();
  const svc = createCardService({ supabase: mock.supabase, env: {} });

  const q1 = { question: "Q one?", options: ["a", "b", "c", "d"], correctIndex: 0 };
  const q2 = { question: "Q two?", options: ["w", "x", "y", "z"], correctIndex: 2 };

  const s1 = await svc.getCarouselSlideUrls({ story: STORY, question: q1 });
  const s2 = await svc.getCarouselSlideUrls({ story: STORY, question: q2 });

  // Different questions ⇒ different variant segment ⇒ no shared URL to upsert over.
  const eng1 = s1.find((s) => s.slideType === "engagement").url;
  const eng2 = s2.find((s) => s.slideType === "engagement").url;
  assert.notEqual(eng1, eng2);
  assert.ok(mock.uploads.every((u) => u.path.includes("/carousel/")));
});

test("cardService.getCarouselSlideUrls: distinct cover hooks get distinct storage paths (no overwrite)", async () => {
  const mock = makeStorageMock();
  const svc = createCardService({ supabase: mock.supabase, env: {} });

  const s1 = await svc.getCarouselSlideUrls({ story: STORY, coverHook: "Markets just hit a three-year inflation low" });
  const s2 = await svc.getCarouselSlideUrls({ story: STORY, coverHook: "Rate cuts are suddenly back on the table" });

  // Different hooks ⇒ different variant segment ⇒ the cover bytes never collide.
  assert.notEqual(s1[0].url, s2[0].url);
  // A hook-less render gets the "nohook" segment, distinct from both hooked ones.
  const s0 = await svc.getCarouselSlideUrls({ story: STORY });
  assert.ok(s0[0].url.includes("-nohook-noill/"));
  assert.ok(!s1[0].url.includes("-nohook-noill/"));
});

test("cardService.getCarouselSlideUrls: same hook, different highlight ⇒ distinct storage paths", async () => {
  const mock = makeStorageMock();
  const svc = createCardService({ supabase: mock.supabase, env: {} });

  const hook = "Oracle cut 21,000 jobs in a year";
  const a = await svc.getCarouselSlideUrls({ story: STORY, coverHook: hook, coverHighlight: "21,000 jobs" });
  const b = await svc.getCarouselSlideUrls({ story: STORY, coverHook: hook, coverHighlight: "Oracle" });
  // The highlighted span changes the cover bytes, so the fingerprint must differ.
  assert.notEqual(a[0].url, b[0].url);
});

test("cardService.getIllustrationUrl: null when OPENAI_API_KEY is absent (Tier-2 disabled)", async () => {
  const mock = makeStorageMock();
  const svc = createCardService({ supabase: mock.supabase, env: {} }); // no OPENAI_API_KEY
  assert.equal(await svc.getIllustrationUrl({ story: STORY, anthropic: {} }), null);
  assert.equal(mock.uploads.length, 0); // never generated/uploaded
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
      { url: `https://cdn.test/${story.id}/0.jpg`, index: 0, slideType: "cover", width: 1080, height: 1350 },
      { url: `https://cdn.test/${story.id}/1.jpg`, index: 1, slideType: "what", width: 1080, height: 1350 },
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
  const engagement = [];
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
      // social_media_assets + social_post_engagement upserts resolve as thenables
      // (no maybeSingle).
      q.then = (res, rej) => {
        if (q.table === "social_media_assets" && q._payload) assets.push(...q._payload);
        if (q.table === "social_post_engagement" && q._payload) engagement.push(q._payload);
        return Promise.resolve({ error: null }).then(res, rej);
      };
      return q;
    },
  };
  return { client, assets, posts, engagement };
}

test("generateSocialPosts: AUTO_APPROVED + carousel media → IG post APPROVED (auto-publishes)", async () => {
  const sb = makeGenSupabase({ candidateStatus: "AUTO_APPROVED" });
  const cardService = {
    getCardUrl: async ({ shape }) => `https://cdn.test/card-${shape}.png`,
    getCarouselSlideUrls: async () => [
      { url: "https://cdn.test/0.jpg", index: 0, slideType: "cover", width: 1080, height: 1350 },
      { url: "https://cdn.test/1.jpg", index: 1, slideType: "what", width: 1080, height: 1350 },
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
      { url: "https://cdn.test/0.jpg", index: 0, slideType: "cover", width: 1080, height: 1350 },
      { url: "https://cdn.test/1.jpg", index: 1, slideType: "what", width: 1080, height: 1350 },
      { url: "https://cdn.test/2.jpg", index: 2, slideType: "why", width: 1080, height: 1350 },
      { url: "https://cdn.test/3.jpg", index: 3, slideType: "cta", width: 1080, height: 1350 },
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

test("generateSocialPosts: IG engagement question → persists a PENDING social_post_engagement row", async () => {
  // Purpose-built supabase: routes social_posts reads to (a) the dedupe/existing
  // check (none) and (b) the engagement "previous POSTED IG post" lookup; routes
  // stories to the current story for the candidate and the prev story for the MCQ.
  const PREV_STORY = { id: 7, headline: "Bank cut rates", summary: "Rates fell.", key_points: ["Rates fell"], category_id: "finance" };
  const engagement = [];
  const inserts = [];
  let seq = 0;
  const supabase = {
    from(table) {
      const q = { table, _eq: {}, _payload: null, _op: null, _hasNot: false };
      q.select = () => q;
      q.eq = (k, v) => { q._eq[k] = v; return q; };
      q.neq = (k, v) => { q._eq[`neq_${k}`] = v; return q; };
      q.not = () => { q._hasNot = true; return q; };       // marks the engagement prev-post query
      q.order = () => q; q.limit = () => q;
      q.upsert = (p) => { q._payload = p; q._op = "upsert"; return q; };
      q.update = (p) => { q._payload = p; q._op = "update"; return q; };
      q.maybeSingle = async () => {
        if (table === "social_publication_candidates") {
          return { data: { id: "cand-1", story_id: STORY.id, audience_geo: "global", status: "PENDING" }, error: null };
        }
        if (table === "stories") {
          return { data: q._eq.id === 7 ? PREV_STORY : STORY, error: null };
        }
        if (table === "social_posts") {
          if (q._op === "update") return { data: null, error: null };
          if (q._op === "upsert") { const row = { id: `post-${++seq}`, ...q._payload }; inserts.push(row); return { data: { id: row.id }, error: null }; }
          return { data: null, error: null }; // existing-check → none
        }
        return { data: null, error: null };
      };
      q.then = (res, rej) => {
        if (table === "social_post_engagement" && q._payload) engagement.push(q._payload);
        // Engagement prev-post lookup now terminates at an awaited .limit() that
        // returns an ARRAY (not .maybeSingle()); the embedded !inner story rides
        // on the social_posts row. `q._hasNot` marks that query (it calls .not()).
        if (table === "social_posts" && q._hasNot) {
          return Promise.resolve({ data: [{ id: "prev-post-1", published_at: "2026-06-20T00:00:00Z", stories: PREV_STORY }], error: null }).then(res, rej);
        }
        return Promise.resolve({ error: null }).then(res, rej);
      };
      return q;
    },
  };
  const cardService = {
    getCardUrl: async ({ shape }) => `https://cdn.test/card-${shape}.jpg`,
    getCarouselSlideUrls: async () => [
      { url: "https://cdn.test/0.jpg", index: 0, slideType: "cover", width: 1080, height: 1350 },
      { url: "https://cdn.test/1.jpg", index: 1, slideType: "engagement", width: 1080, height: 1350 },
    ],
  };
  const anthropic = {
    messages: { create: async () => ({ content: [{ text: JSON.stringify({ question: "What did the bank do?", options: ["Cut", "Raised", "Held", "Paused"], correctIndex: 0 }) }] }) },
  };
  await generateSocialPosts({ supabase, anthropic, cardService, igCarousel: true, igEngagement: true, candidateId: "cand-1" });

  assert.equal(engagement.length, 1);
  const row = engagement[0];
  assert.equal(row.comment_status, "PENDING");
  assert.equal(row.question, "What did the bank do?");
  assert.equal(row.correct_index, 0);
  assert.equal(row.answer, "Cut");
  assert.equal(row.source_post_id, "prev-post-1");
  assert.ok(row.social_post_id);
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
