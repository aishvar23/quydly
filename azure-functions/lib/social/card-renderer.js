// Story card renderer. Design §8 (reach) + L4 (Instagram carousel).
//
// Renders branded cards as raster images, so social posts carry media (the
// single biggest reach lever on X, and the asset Instagram requires before it
// can publish). Pure-JS pipeline — Satori (JSX-like → SVG), resvg (SVG → PNG),
// and pngjs+jpeg-js (PNG → JPEG) — so it runs in an Azure Function with no
// headless browser and no extra native binary beyond resvg.
//
//   renderStoryCard(story, { shape, format })   → single card
//     { buffer, contentType, width, height }
//   renderCarouselSlides(story, { format })     → Instagram carousel (L4)
//     [ { buffer, contentType, width, height, slideType, index }, ... ]
//
// shape:  "landscape" (1600×900, X) | "square" (1080×1080, Instagram).
// format: "png" (default — X media path) | "jpeg" (Instagram Graph API, which
//         only accepts JPEG for media containers).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { accentFor } from "./_categories.js";
import { validateMCQ } from "./mcq.js";
import { QUYDLY_IG_HANDLE } from "./platforms/_shared.js";
import { classifySensitivity, SENSITIVITY, SAFE_CATEGORIES } from "./social-safety.js";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");

// Per-category accent colour lives in _categories.js (single source of truth,
// shared with the hashtag derivation) so the id set can't drift between them.
const BG = "#0B0F1A";
const FG = "#FFFFFF";
const MUTED = "#9CA3AF";
// Cover-hook keyword highlight. HIGHLIGHT_MARKER is the filled "highlighter"
// colour (TSJ-style) used in the default "marker" mode; "accent" mode tints the
// key span in the category accent instead. Mode is a single brand-level choice.
const HIGHLIGHT_MARKER = "#FFE14D";
const HIGHLIGHT_MODE = "marker"; // "marker" | "accent"

const SHAPES = {
  landscape: { width: 1600, height: 900 },
  square: { width: 1080, height: 1080 },
  // 4:5 portrait — the carousel slide format. Takes ~25% more vertical feed
  // space than square; the extra height becomes breathing room for the hook.
  portrait: { width: 1080, height: 1350 },
};

// Carousel slide order. "Key points" and "Why it matters" are SEPARATE slides:
// cover / what happened / key points / why it matters / engagement / CTA. The
// "why" slide is included only when the generator supplied historical points for
// it (whyItMatters) — otherwise it is dropped. The "engagement" slide (an MCQ
// drawn from the PREVIOUS post's story, inviting a reply) is included only when a
// question is supplied; it always sits SECOND-TO-LAST, immediately before the
// CTA, in both order arrays. CAROUSEL_SLIDES is the full ordered set.
const CAROUSEL_SLIDES = ["cover", "what", "keypoints", "why", "engagement", "cta"];
const CAROUSEL_SLIDES_NO_WHY = ["cover", "what", "keypoints", "engagement", "cta"];

// Pick the slide list for a story based on whether historical "why it matters"
// points were supplied and whether an engagement MCQ was supplied. Each optional
// slide is dropped when it would be empty, so a story with neither renders the
// original 4-slide set (cover/what/keypoints/cta).
function carouselSlidesFor(whyItMatters, question) {
  const why = Array.isArray(whyItMatters) ? whyItMatters.filter(Boolean) : [];
  let list = why.length ? CAROUSEL_SLIDES : CAROUSEL_SLIDES_NO_WHY;
  if (!isEngagementQuestion(question)) list = list.filter((k) => k !== "engagement");
  return list;
}

// A usable engagement MCQ: a question string + exactly 4 option strings + a valid
// correctIndex. Anything short of that → no engagement slide (silent fallback).
// Shared with the platform MCQ generators via validateMCQ (same semantics).
const isEngagementQuestion = validateMCQ;
const JPEG_QUALITY = 85;

// ── Instagram-grid safe zone ─────────────────────────────────────────────────
//
// The Instagram PROFILE GRID renders a centred square thumbnail of each post and
// trims a few percent off every edge for the tile gutter. Content that sits hard
// against the old 7.5% padding got sliced in the grid (left edge of the wordmark
// and headline lost their first glyph: "QUYDLY"→"QYDLY", "JEE…"→"EE…"). We pull
// all text inside a wider HORIZONTAL safe zone (~12.5% / 135px on a 1080 card) so
// nothing the grid crop touches carries meaning, while keeping VERTICAL padding
// at the original 7.5% so the opened post stays well-balanced top-to-bottom.
const PAD_X_RATIO = 0.125; // horizontal — grid-crop safe
const PAD_Y_RATIO = 0.075; // vertical — unchanged, opened-post look

// Headlines longer than this render in the compact font so they stay inside the
// card. Tuned to the horizontal safe zone: the grid-safe PAD_X_RATIO narrows the
// text column ~12% vs the old 7.5% padding, so a headline wraps as if ~13%
// longer. Dropping to the smaller size sooner keeps long headlines — especially
// when the cover also stacks a date line and a portrait — from overflowing.
const HEADLINE_COMPACT_CHARS = 80;

// ── Cover date line ──────────────────────────────────────────────────────────
//
// "Tuesday · 3 June 2026" rendered on the cover slide, derived from the story's
// publish date (stories.published_at — the canonical pipeline timestamp, and the
// only timestamp the stories table carries; there is no stories.created_at). We
// label in IST (+05:30) because the audience is India-heavy, so the displayed day
// reads as the viewer's local day rather than UTC. Near a day boundary this can
// differ from the pipeline's UTC day (a late-UTC timestamp renders as the next
// IST day), which is intentional. Returns "" when there is no usable date — the
// cover then renders headline-only.
//
// We format from explicit English names against a manually IST-shifted instant,
// not Intl + timeZone:"Asia/Kolkata". Intl's timezone support needs full-ICU tz
// data in the runtime, and the en-GB date order needs that locale to ship too; a
// small-ICU host would silently format in UTC and/or US order. The card text is
// English-only, so fixed name tables are both dependency-free and deterministic.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function coverDateLine(story) {
  const raw = story && story.published_at;
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  // Shift the UTC instant by +05:30, then read its UTC wall-clock parts — those
  // parts ARE the IST date. Produces "Tuesday · 3 June 2026".
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${WEEKDAYS[ist.getUTCDay()]} · ${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

// A short "via <source>" attribution for the cover, drawn from the highest-
// authority source document the synthesiser attached (stories.source_documents
// is persisted authority-first — see platforms/_sources.js). Prefers the human
// issuer name ("Reuters"); falls back to the bare hostname of the source URL
// (www. stripped). Returns "" when no usable source exists (cover omits the line
// rather than inventing one). Mirrors the @vesting cover's source badge.
function coverSource(story) {
  const docs = Array.isArray(story?.source_documents) ? story.source_documents : [];
  for (const d of docs) {
    const issuer = oneLine(d?.issuer);
    if (issuer) return issuer.slice(0, 40);
    const url = typeof d?.url === "string" ? d.url : "";
    const m = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(url);
    if (m) return m[1].toLowerCase();
  }
  return "";
}

let _fonts = null;
async function loadFonts() {
  if (_fonts) return _fonts;
  const [regular, bold] = await Promise.all([
    readFile(join(FONT_DIR, "Lato-Regular.ttf")),
    readFile(join(FONT_DIR, "Lato-Bold.ttf")),
  ]);
  _fonts = [
    { name: "Lato", data: regular, weight: 400, style: "normal" },
    { name: "Lato", data: bold, weight: 700, style: "normal" },
  ];
  return _fonts;
}

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// stories.key_points is jsonb — usually string[], occasionally [{text}].
function keyPoints(story) {
  const kp = story && story.key_points;
  if (!Array.isArray(kp)) return [];
  return kp
    .map((p) => (typeof p === "string" ? p : p && (p.text || p.point)) || "")
    .map((s) => oneLine(s))
    .filter(Boolean);
}

// First N sentences of a blob, whitespace-normalised.
function firstSentences(text, n = 2) {
  const clean = oneLine(text);
  if (!clean) return "";
  const parts = clean.match(/[^.!?]+[.!?]+/g);
  if (!parts) return clean;
  return parts.slice(0, n).join(" ").trim();
}

// ── Lead-person portrait (cover-slide inset) ─────────────────────────────────
//
// When a story is about a person, surface their photo on the cover slide. The
// licensed portrait is already attached upstream by the synthesiser's
// attachWikipediaToEntities step: every `primary_entities_enriched` person
// entry carries either an editor `portrait_*` override (a press photo with
// explicit attribution+license) or a Wikipedia lead image. We use ONLY those
// already-licensed sources — never a news-article image — and always render a
// credit line. Source order matches the synthesiser's preference: override wins.

const PORTRAIT_FETCH_TIMEOUT_MS = 4000;
const PORTRAIT_MAX_BYTES = 6_000_000;
const PORTRAIT_CREDIT_MAX = 64;

// Short credit string for an enriched entity's portrait. Overrides require
// attribution (migration_data_quality_p2_5: "never render without telling the
// viewer where it came from"); the Wikipedia path falls back to its license.
function portraitCredit(entity) {
  // Overrides carry a real attribution string; the Wikipedia path is always
  // credited simply as "Wikipedia" (rendered "Photo: Wikipedia").
  const raw = entity.portrait_source === "override"
    ? (entity.portrait_attribution || entity.portrait_license || "")
    : "Wikipedia";
  const credit = oneLine(raw);
  return credit.length > PORTRAIT_CREDIT_MAX
    ? `${credit.slice(0, PORTRAIT_CREDIT_MAX - 1).trimEnd()}…`
    : credit;
}

// Wikimedia thumbnail URLs carry a "/NNNpx-<file>" size token; bump it so the
// large cover image isn't upscaled-blurry. Non-Wikimedia or non-thumb URLs are
// returned unchanged.
function upscaleWikimedia(url, px) {
  if (typeof url !== "string") return url;
  if (!/^https:\/\/upload\.wikimedia\.org\/.+\/thumb\//.test(url)) return url;
  return url.replace(/\/\d+px-([^/]+)$/, `/${px}px-$1`);
}

// The image for the cover hero. primary_entities_enriched is ordered by primacy.
// Prefer the LEAD person (first person entity) — never a later person, which
// would put the wrong face on the cover — then fall back to the first org/place
// with a licensed image (a logo or landmark carries no wrong-face risk and gives
// the many non-person stories a real graphic). Only already-licensed Wikipedia/
// override sources are used, and always credited. Returns { url, name, credit }
// or null (text-only cover). The thumbnail is upscaled for the large render.
// Candidate image URLs for an entity, in fetch-preference order. EVERY licensed
// source (full override → thumbnail → Wikipedia) contributes a couple of larger
// Wikimedia renders plus the original. The caller tries them until one fetches,
// so a too-large full-resolution override (rejected over PORTRAIT_MAX_BYTES)
// falls through to its smaller thumbnail rather than to the generic floor.
// (Wikimedia 400s on a thumbnail wider than the source — hence the size ladder.)
function entityImageUrls(e) {
  const sources = [e?.portrait_image_url, e?.portrait_thumbnail_url, e?.wikipedia_thumbnail_url]
    .filter((u) => typeof u === "string" && /^https:\/\//i.test(u));
  return [...new Set(sources.flatMap((s) => [upscaleWikimedia(s, 800), upscaleWikimedia(s, 500), s]))];
}

// HIGH-sensitivity NEWS stories (death / violence / disaster) must NOT lead with
// a person's posed stock portrait: a smiling PR headshot over a tragedy reads as
// callous, and the lead "person" is often only tangential (e.g. an official who
// commented on it, not a subject of it). On those stories we drop PERSON faces
// from slide imagery — a neutral org/place photo is used instead, else (via the
// generator's hasEntityImage check) a symbolic illustration, else the brand
// floor. MEDIUM/LOW (e.g. an election with the candidate) keep faces.
//
// The brand-safe categories (culture / science / technology / finance) are
// EXEMPT even when the keyword classifier returns HIGH: there a violence term is
// almost always fictional/metaphorical (a TV plot where a character is "killed",
// a market "crash"), not a real tragedy, and the relevant person photo should
// stay. Real tragedies land in the news categories (e.g. "world"), which are not
// exempt. Gated on the shared classifier (social-safety.js) so the rule can't
// drift from the auto-approval/sensitivity logic.
function excludePeopleImagery(story) {
  if (classifySensitivity(story) !== SENSITIVITY.HIGH) return false;
  const category = story?.category_id || story?.category;
  return !(category && SAFE_CATEGORIES.has(category));
}

// The lead PERSON's licensed image spec (the first person entity with a usable
// image), or null. This is the ONLY photo allowed to HERO the cover: an org logo
// or a place flag must never pre-empt an editorial illustration there — they are
// demoted to a last resort (see renderCarouselSlides). HIGH-sensitivity stories
// drop the posed face entirely (excludePeopleImagery), so the cover gets an
// illustration instead of a smiling headshot over a tragedy.
function leadPersonImage(story) {
  if (excludePeopleImagery(story)) return null;
  const ents = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  const lead = ents.find((e) => e && e.type === "person");
  if (!lead) return null;
  const urls = entityImageUrls(lead);
  return urls.length ? { urls, name: oneLine(lead.name), credit: portraitCredit(lead), type: lead.type } : null;
}

// The first org/place entity with a licensed image (a logo or a landmark/flag),
// or null. Used as the cover's LAST-RESORT hero — only when there is neither a
// person photo NOR an illustration — and as a body-slide imagery source.
function leadOrgPlaceImage(story) {
  const ents = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  for (const e of ents) {
    if (e && (e.type === "org" || e.type === "place")) {
      const urls = entityImageUrls(e);
      if (urls.length) return { urls, name: oneLine(e.name), credit: portraitCredit(e), type: e.type };
    }
  }
  return null;
}

// All entities with a licensed image, in primacy order (de-duped by name) — used
// to spread real imagery across the body slides. Unlike the cover, body images
// are captioned with the entity name, so a non-lead entity is fine here.
function entityImages(story) {
  const ents = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  const skipPeople = excludePeopleImagery(story);
  const out = [];
  const seen = new Set();
  for (const e of ents) {
    if (!e || seen.has(e.name)) continue;
    if (skipPeople && e.type === "person") continue; // no faces on tragic stories
    const urls = entityImageUrls(e);
    if (!urls.length) continue;
    seen.add(e.name);
    out.push({ urls, name: oneLine(e.name), credit: portraitCredit(e), type: e.type });
  }
  return out;
}

// SINGLE SOURCE OF TRUTH for cover/body image sourcing, shared by the renderer's
// allocation (renderCarouselSlides) and the generator's illustration sizing
// (plannedIllustrationCount), so the two can't drift. Given the story and the
// content slide kinds present (cover / what / key points / [why]), it returns:
//   coverSpec         — the lead PERSON image (the only photo allowed to hero the
//                       cover), or null;
//   coverFallbackSpec — the lead org/place image RESERVED as the cover's last
//                       resort (only when no person cover), or null;
//   bodyKinds         — the non-cover content kinds present;
//   bodySpecs         — the entity images for the body slides, with the reserved
//                       cover entity held back so it never appears on both.
function planEntityImagery(story, contentKinds) {
  const hasCover = contentKinds.includes("cover");
  const coverSpec = hasCover ? leadPersonImage(story) : null;
  const coverFallbackSpec = (hasCover && !coverSpec) ? leadOrgPlaceImage(story) : null;
  const reservedName = coverSpec?.name || coverFallbackSpec?.name;
  const bodyKinds = contentKinds.filter((k) => k !== "cover");
  const bodySpecs = entityImages(story).filter((s) => s.name !== reservedName).slice(0, bodyKinds.length);
  return { hasCover, coverSpec, coverFallbackSpec, bodyKinds, bodySpecs };
}

// How many editorial illustrations the carousel needs — one for every content
// slide (cover / what / key points / [why]) that won't be backed by a usable
// PHOTO under the sourcing rules in planEntityImagery. The cover is photo-backed
// ONLY by a lead PERSON image; org logos / place flags never pre-empt an
// illustration on the cover (so it never falls back to a "dumb" logo/flag or the
// gradient when an illustration is possible). The generator generates exactly this
// many, and renderCarouselSlides routes them to precisely those photo-less slides.
export function plannedIllustrationCount(story, { whyItMatters = [] } = {}) {
  const hasWhy = Array.isArray(whyItMatters) && whyItMatters.filter(Boolean).length > 0;
  const contentKinds = ["cover", "what", "keypoints", ...(hasWhy ? ["why"] : [])];
  const { coverSpec, bodySpecs } = planEntityImagery(story, contentKinds);
  const coverPhoto = coverSpec ? 1 : 0;
  return Math.max(0, contentKinds.length - coverPhoto - bodySpecs.length);
}

// Fetch the first of an image spec's candidate URLs that yields a data URI (or
// null). Best-effort — used for both the cover and the body-slide images.
async function resolveImage(spec, fetchImpl) {
  if (!spec) return null;
  for (const url of spec.urls) {
    const dataUri = await fetchImageDataUri(url, fetchImpl ? { fetchImpl } : {});
    if (dataUri) return { dataUri, name: spec.name, credit: spec.credit, type: spec.type };
  }
  return null;
}

// Read a fetch Response body, aborting once it exceeds maxBytes. Streams via
// res.body when the runtime exposes it (real fetch) so an oversize or lying
// content-length can't buffer unbounded into Function memory; falls back to
// arrayBuffer for response doubles that lack a stream, still enforcing the cap.
async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length <= maxBytes ? buf : null;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* best-effort abort */ }
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return total ? Buffer.concat(chunks) : null;
}

// Fetch a remote image into a base64 data URI so Satori can embed it inline
// (no network during rasterisation). Best-effort: any problem — timeout,
// non-image, oversize, network error — returns null and the caller falls back
// to the text-only cover. HTTPS-only is enforced by leadPersonPortrait. The
// PORTRAIT_MAX_BYTES cap is enforced first via content-length (when advertised)
// and then during the streamed download, so it holds even without the header.
async function fetchImageDataUri(url, { fetchImpl = fetch, timeoutMs = PORTRAIT_FETCH_TIMEOUT_MS, maxBytes = PORTRAIT_MAX_BYTES } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
    if (!res || !res.ok) return null;
    const ct = (res.headers?.get?.("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) return null;
    const declared = Number(res.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const buf = await readCapped(res, maxBytes);
    if (!buf) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Satori accepts a React-element-shaped object literal ({ type, props }), so we
// build the tree by hand and avoid a JSX/build step.
function el(type, props, children) {
  return { type, props: { ...props, children } };
}

// SVG → raster bytes. PNG via resvg; JPEG via a pngjs decode + jpeg-js encode
// (Instagram's media container only accepts JPEG). Both converters are pure JS.
function rasterize(svg, { width, format }) {
  const png = new Resvg(svg, { background: BG, fitTo: { mode: "width", value: width } })
    .render()
    .asPng();

  if (format === "jpeg" || format === "jpg") {
    const decoded = PNG.sync.read(Buffer.from(png));
    const { data } = jpeg.encode(
      { data: decoded.data, width: decoded.width, height: decoded.height },
      JPEG_QUALITY
    );
    return { buffer: data, contentType: "image/jpeg" };
  }
  return { buffer: png, contentType: "image/png" };
}

// ── Single headline card (X landscape / IG square) ───────────────────────────

function cardTree({ headline, category, accent, width, height }) {
  const padX = Math.round(width * PAD_X_RATIO);
  const padY = Math.round(width * PAD_Y_RATIO);
  return el("div", {
    style: {
      width, height, display: "flex", flexDirection: "column",
      justifyContent: "space-between", backgroundColor: BG,
      padding: `${padY}px ${padX}px`, fontFamily: "Lato",
    },
  }, [
    // Top: brand + category chip
    el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, [
      el("div", { style: { fontSize: Math.round(width * 0.034), fontWeight: 700, color: FG, letterSpacing: 1 } }, "QUYDLY"),
      el("div", {
        style: {
          display: "flex", fontSize: Math.round(width * 0.022), fontWeight: 700,
          color: BG, backgroundColor: accent, padding: "10px 22px", borderRadius: 999,
          textTransform: "uppercase", letterSpacing: 1,
        },
      }, category),
    ]),
    // Middle: headline
    el("div", {
      style: {
        display: "flex", color: FG, fontWeight: 700,
        fontSize: Math.round(width * (headline.length > HEADLINE_COMPACT_CHARS ? 0.052 : 0.066)),
        lineHeight: 1.15,
      },
    }, headline),
    // Bottom: accent rule + CTA
    el("div", { style: { display: "flex", flexDirection: "column" } }, [
      el("div", { style: { display: "flex", width: Math.round(width * 0.14), height: 8, backgroundColor: accent, marginBottom: 24 } }, []),
      el("div", { style: { display: "flex", fontSize: Math.round(width * 0.026), color: MUTED } }, "Take today's news quiz"),
    ]),
  ]);
}

export async function renderStoryCard(story, { shape = "landscape", format = "png" } = {}) {
  const { width, height } = SHAPES[shape] || SHAPES.landscape;
  const accent = accentFor(story?.category_id);
  const headline = oneLine(story?.headline) || "Today's news quiz";
  const category = oneLine(story?.category_id || "news");
  const fonts = await loadFonts();

  const svg = await satori(cardTree({ headline, category, accent, width, height }), { width, height, fonts });
  const { buffer, contentType } = rasterize(svg, { width, format });
  return { buffer, contentType, width, height };
}

// ── Instagram carousel slides (L4) ───────────────────────────────────────────

// Shared chrome: brand + category chip on top, page indicator on the bottom
// right, so the four slides read as one set.
// The brand wordmark + category chip shown at the top of every slide. Shared by
// the padded body slides (slideHeader) and the full-bleed cover (coverTree) so
// the chrome can't drift between the two layouts.
function brandMarks({ category, accent, size }) {
  return [
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.034), fontWeight: 700, color: FG, letterSpacing: 1 } }, "QUYDLY"),
    el("div", {
      style: {
        display: "flex", fontSize: Math.round(size * 0.022), fontWeight: 700,
        color: BG, backgroundColor: accent, padding: "10px 22px", borderRadius: 999,
        textTransform: "uppercase", letterSpacing: 1,
      },
    }, category),
  ];
}

function slideHeader({ category, accent, size }) {
  return el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, brandMarks({ category, accent, size }));
}

function slideFooter({ accent, size, index, total, hint }) {
  return el("div", { style: { display: "flex", alignItems: "flex-end", justifyContent: "space-between" } }, [
    el("div", { style: { display: "flex", flexDirection: "column" } }, [
      el("div", { style: { display: "flex", width: Math.round(size * 0.14), height: 8, backgroundColor: accent, marginBottom: 18 } }, []),
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.024), color: MUTED } }, hint || ""),
    ]),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.024), color: MUTED } }, `${index + 1} / ${total}`),
  ]);
}

// A coloured eyebrow label ("WHAT HAPPENED", "WHY IT MATTERS").
function eyebrow(text, accent, size) {
  return el("div", {
    style: {
      display: "flex", fontSize: Math.round(size * 0.03), fontWeight: 700,
      color: accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 24,
    },
  }, text);
}

function bulletRow(text, accent, size, fontPx = Math.round(size * 0.038)) {
  return el("div", { style: { display: "flex", alignItems: "flex-start", marginBottom: 22 } }, [
    el("div", {
      style: {
        display: "flex", width: 16, height: 16, borderRadius: 999,
        backgroundColor: accent, marginTop: Math.round(fontPx * 0.5), marginRight: 22, flexShrink: 0,
      },
    }, []),
    el("div", { style: { display: "flex", fontSize: fontPx, color: FG, lineHeight: BULLET_LINE_H } }, text),
  ]);
}

// ── Bullet-slide auto-fit (key points / why it matters) ──────────────────────
//
// The 4:5 card height is FIXED, and Satori has no overflow handling, so long key
// points used to spill past the bottom and clip the last bullet (IG showed a
// cut-off third point). The bullets now sit in the scrimmed lower zone of a
// full-bleed image slide, so we size deterministically to fit a caller-supplied
// pixel budget: step the bullet font DOWN through the levels until the estimated
// stack fits, trimming the points (word boundary, "…") only if even the smallest
// level overflows. Heights are estimated from a conservative average glyph advance
// (Lato ≈ 0.52em) so we err toward NOT clipping; short points keep the default
// size (no regression).
const BULLET_LINE_H = 1.25;
const BULLET_AVG_CHAR_EM = 0.52;
const BULLET_FONT_LEVELS = [0.038, 0.035, 0.033, 0.031, 0.029]; // densest → smallest

// Estimated stacked height (px) of `points` rendered as bullets at `fontPx`.
function bulletStackHeight(points, fontPx, size) {
  const colW = size * (1 - 2 * PAD_X_RATIO) - (16 + 22); // text column minus the dot + its right margin
  const cpl = Math.max(8, colW / (fontPx * BULLET_AVG_CHAR_EM));
  let h = 0;
  for (const p of points) h += Math.max(1, Math.ceil(p.length / cpl)) * fontPx * BULLET_LINE_H + 22;
  return h;
}

// Pick the densest font that fits `points` into `budgetPx` of vertical space.
// Returns { fontPx, points }; points are trimmed only as a last resort.
function fitBulletSlide(points, size, budgetPx) {
  for (const level of BULLET_FONT_LEVELS) {
    const fontPx = Math.round(size * level);
    if (bulletStackHeight(points, fontPx, size) <= budgetPx) {
      return { fontPx, points };
    }
  }
  // Smallest level still overflows → trim each point to its share of the budget,
  // on a word boundary, with an ellipsis (clean cut, not an IG clip).
  const fontPx = Math.round(size * BULLET_FONT_LEVELS[BULLET_FONT_LEVELS.length - 1]);
  const colW = size * (1 - 2 * PAD_X_RATIO) - 38;
  const cpl = Math.max(8, colW / (fontPx * BULLET_AVG_CHAR_EM));
  const linesEach = Math.max(1, Math.floor((budgetPx / points.length - 22) / (fontPx * BULLET_LINE_H)));
  const maxChars = Math.max(40, Math.floor(linesEach * cpl));
  const trimmed = points.map((p) => (p.length <= maxChars ? p : `${p.slice(0, maxChars).replace(/\s+\S*$/, "").trim()}…`));
  return { fontPx, points: trimmed };
}

// One MCQ option row on the engagement slide: a lettered chip (A/B/C/D) + the
// option text. The slide NEVER reveals which is correct — the answer is posted
// later as a comment — so all four chips render identically.
function optionRow(letter, text, accent, size) {
  return el("div", { style: { display: "flex", alignItems: "center", marginBottom: 20 } }, [
    el("div", {
      style: {
        display: "flex", alignItems: "center", justifyContent: "center",
        width: Math.round(size * 0.06), height: Math.round(size * 0.06), borderRadius: 12,
        backgroundColor: accent, color: BG, fontWeight: 700, fontSize: Math.round(size * 0.03),
        marginRight: 22, flexShrink: 0,
      },
    }, letter),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.036), color: FG, lineHeight: 1.25 } }, text),
  ]);
}

// Reduce a token to a comparison key: lowercase, strip everything except
// alphanumerics, $ and % (so "21,000" and "strikes." compare cleanly).
function hlKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9$%]/g, "");
}

// Indices of the words in `words` that fall inside `highlight` — the first
// contiguous run whose normalised tokens match the highlight's. Empty set when
// the highlight is blank or not found (→ the cover renders without emphasis).
function highlightWordIndices(words, highlight) {
  const set = new Set();
  const hi = String(highlight || "").split(/\s+/).map(hlKey).filter(Boolean);
  if (!hi.length) return set;
  // Match over only the words with a non-empty key, keeping their original index,
  // so a punctuation-only token (e.g. a standalone "—") between two highlighted
  // words doesn't break the contiguous run.
  const toks = [];
  words.forEach((w, idx) => { const k = hlKey(w); if (k) toks.push({ idx, k }); });
  for (let i = 0; i + hi.length <= toks.length; i++) {
    let match = true;
    for (let j = 0; j < hi.length; j++) { if (toks[i + j].k !== hi[j]) { match = false; break; } }
    if (match) { for (let j = 0; j < hi.length; j++) set.add(toks[i + j].idx); return set; }
  }
  return set;
}

// The cover headline block, sized to its length. When `highlight` matches a span
// of the hook, those words are emphasised (filled marker, or accent-tinted text
// in "accent" mode) — rendered as word-level flex items so the line wraps
// naturally while the highlight hugs only its words. Falls back to a single plain
// text node when there is nothing to highlight (the pre-highlight layout).
function coverHeadline(headline, size, { highlight = "", mode = HIGHLIGHT_MODE, accent = FG } = {}) {
  const fontSize = Math.round(size * (headline.length > HEADLINE_COMPACT_CHARS ? 0.058 : 0.072));
  const words = headline.split(/\s+/).filter(Boolean);
  const hi = highlightWordIndices(words, highlight);

  if (!hi.size) {
    return el("div", { style: { display: "flex", color: FG, fontWeight: 700, fontSize, lineHeight: 1.15 } }, headline);
  }

  const gap = Math.round(fontSize * 0.26);     // inter-word space
  const rowGap = Math.round(fontSize * 0.2);   // line spacing between wrapped rows
  const padX = Math.round(fontSize * 0.14);
  const base = { display: "flex", fontWeight: 700, fontSize, lineHeight: 1.15, marginRight: gap, marginBottom: rowGap };

  // The highlight span is contiguous, so render it as ONE block (a single
  // continuous marker box / accent run) rather than a box per word. As an
  // unbreakable unit it also wraps whole to the next line if it doesn't fit.
  const idx = [...hi].sort((a, b) => a - b);
  const hiStart = idx[0];
  const hiEnd = idx[idx.length - 1];
  const children = [];
  for (let i = 0; i < words.length; i++) {
    if (i < hiStart || i > hiEnd) {
      children.push(el("div", { style: { ...base, color: FG } }, words[i]));
    } else if (i === hiStart) {
      const phrase = words.slice(hiStart, hiEnd + 1).join(" ");
      children.push(mode === "accent"
        ? el("div", { style: { ...base, color: accent } }, phrase)
        : el("div", { style: { ...base, color: BG, backgroundColor: HIGHLIGHT_MARKER, paddingLeft: padX, paddingRight: padX, borderRadius: Math.round(fontSize * 0.09) } }, phrase));
    } // words strictly inside (hiStart, hiEnd] are folded into the phrase above
  }
  return el("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "flex-start" } }, children);
}

// "Tuesday · 3 June 2026" eyebrow above the cover headline. Returns null when
// the story has no usable publish date (cover then renders headline-only). Light
// neutral (not the category accent) so it stays legible over ANY cover image —
// an accent-coloured date washes out against a same-hue photo (e.g. green over
// grass); the dark scrim makes a near-white eyebrow read everywhere.
function coverDateRow(story, size) {
  const text = coverDateLine(story);
  if (!text) return null;
  return el("div", {
    style: {
      display: "flex", fontSize: Math.round(size * 0.026), fontWeight: 700,
      color: "rgba(255,255,255,0.82)", letterSpacing: 1, marginBottom: Math.round(size * 0.035),
    },
  }, text);
}

// Shift a #rrggbb hex by `amt` per channel (negative darkens). Used to build the
// brand-graphic gradient from a category accent.
function shade(hex, amt) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shiftBits) => Math.max(0, Math.min(255, ((n >> shiftBits) & 255) + amt));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

// Whether an entity image must be shown WHOLE rather than cropped to fill. An ORG
// entity's licensed lead image is almost always a LOGO / wordmark, and "cover"
// (scale-to-fill + crop) mangles those: it slices the edges of a wordmark
// ("BROWNSTONE" → "ROWNSTON") and balloons a compact mark to fill the frame (the
// giant "DB"). Person/place images are photographs, and generated illustrations
// (no `type`) are full-frame art — both look best edge-to-edge (cover). So only
// org AND place images are contained; only person photos (and illustrations,
// which carry no `type`) cover. A place entity's Wikipedia lead image is usually a
// national flag / coat-of-arms / map — logo-like, not a scene photo — so covering
// it stretches/crops it the same way an org wordmark gets mangled. An explicit
// `contain: true` also forces containment (the cover's last-resort org/place hero).
function isLogoImage(image) {
  return image?.contain === true || image?.type === "org" || image?.type === "place";
}

// The full-bleed background for a slide, as a stack of absolutely-positioned
// layers (so callers can drop a scrim + content on top). Three cases:
//   • photo / illustration → a single <img> that COVERS the whole frame (the
//     editorial look — image bleeds to every edge), biased toward the upper third
//     so a face/subject survives the bottom scrim;
//   • logo (org)           → the category-accent gradient floor with the logo
//     CONTAINED (whole, uncropped) in the upper ~60%, so a wordmark reads cleanly;
//   • no image             → the gradient floor alone, so a slide is never bare.
function slideBackground({ image, accent, size, height, photoPosition = "center 28%" }) {
  const gradient = el("div", {
    style: {
      position: "absolute", top: 0, left: 0, display: "flex", width: size, height,
      backgroundImage: `linear-gradient(135deg, ${shade(accent, 22)}, ${shade(accent, -82)})`,
    },
  }, []);
  if (!image || !image.dataUri) return [gradient];
  if (isLogoImage(image)) {
    const logoW = Math.round(size * 0.62);
    const logoH = Math.round(height * 0.40);
    const logoLayer = el("div", {
      style: {
        position: "absolute", top: 0, left: 0, width: size, height: Math.round(height * 0.62),
        display: "flex", alignItems: "center", justifyContent: "center",
      },
    }, [
      el("img", { src: image.dataUri, width: logoW, height: logoH, style: { width: logoW, height: logoH, objectFit: "contain" } }),
    ]);
    return [gradient, logoLayer];
  }
  return [
    el("img", {
      src: image.dataUri, width: size, height,
      style: { position: "absolute", top: 0, left: 0, width: size, height, objectFit: "cover", objectPosition: photoPosition },
    }),
  ];
}

// Legibility scrim for the text-heavy body slides (what / key points / why):
// near-transparent at the top so the image reads, ramping to almost-opaque BG in
// the bottom half where the eyebrow + bullets sit. Heavier than the cover scrim
// because body slides carry more text over the image.
function contentScrim(size, height) {
  return el("div", {
    style: {
      position: "absolute", top: 0, left: 0, display: "flex", width: size, height,
      backgroundImage: "linear-gradient(180deg, rgba(11,15,26,0.10) 0%, rgba(11,15,26,0.28) 34%, rgba(11,15,26,0.80) 58%, rgba(11,15,26,0.96) 100%)",
    },
  }, []);
}

// Build the inner body for the TEXT-ONLY utility slides (engagement / cta). The
// image-led slides (cover / what / key points / why) have their own full-bleed
// layout (coverTree / contentSlideTree), so this only ever sees engagement & cta.
// `question` (engagement only) is the MCQ { question, options, correctIndex }.
function slideBody({ kind, accent, size, question }) {
  if (kind === "engagement") {
    // The MCQ drawn from the PREVIOUS post's story. Poses the question + 4
    // lettered options and invites a reply with the reader's pick. The correct
    // answer is NEVER shown here — it is revealed in a comment 12h later.
    const q = oneLine(question?.question) || "Today's quiz question";
    const options = (Array.isArray(question?.options) ? question.options : []).slice(0, 4);
    const letters = ["A", "B", "C", "D"];
    return el("div", { style: { display: "flex", flexDirection: "column" } }, [
      eyebrow("Knowledge test", accent, size),
      el("div", {
        style: { display: "flex", color: FG, fontWeight: 700, fontSize: Math.round(size * 0.046), lineHeight: 1.25, marginBottom: Math.round(size * 0.05) },
      }, q),
      ...options.map((opt, i) => optionRow(letters[i], oneLine(opt), accent, size)),
      el("div", {
        style: { display: "flex", fontSize: Math.round(size * 0.032), color: MUTED, lineHeight: 1.3, marginTop: Math.round(size * 0.03) },
      }, "Reply with your pick in the comments"),
    ]);
  }

  // cta — a pure follow ask. The handle is the hero; the supporting line is a
  // CONTENT promise, not the quiz (we no longer funnel IG traffic to the quiz).
  return el("div", { style: { display: "flex", flexDirection: "column" } }, [
    el("div", {
      style: { display: "flex", color: FG, fontWeight: 700, fontSize: Math.round(size * 0.058), lineHeight: 1.15, marginBottom: Math.round(size * 0.016) },
    }, "Follow for tomorrow's brief"),
    el("div", {
      style: { display: "flex", color: accent, fontWeight: 700, fontSize: Math.round(size * 0.056), lineHeight: 1.2, marginBottom: Math.round(size * 0.04) },
    }, QUYDLY_IG_HANDLE()),
    el("div", {
      style: { display: "flex", fontSize: Math.round(size * 0.04), color: MUTED, lineHeight: 1.35 },
    }, "The day's biggest stories, decoded."),
  ]);
}

// The padded text body slides (engagement / cta) — solid-BG cards with no image.
// The image-led slides have their own full-bleed layout, so this only ever sees
// the text-only utility kinds.
function slideTree({ kind, accent, category, index, total, size, height, question }) {
  const padX = Math.round(size * PAD_X_RATIO);
  const padY = Math.round(size * PAD_Y_RATIO);
  const hint = kind === "engagement" ? "Tap to comment →" : "";
  return el("div", {
    style: {
      width: size, height, display: "flex", flexDirection: "column",
      justifyContent: "space-between", backgroundColor: BG,
      padding: `${padY}px ${padX}px`, fontFamily: "Lato",
    },
  }, [
    slideHeader({ category, accent, size }),
    el("div", { style: { display: "flex", flexGrow: 1, flexDirection: "column", justifyContent: "center" } }, [
      slideBody({ kind, accent, size, question }),
    ]),
    slideFooter({ accent, size, index, total, hint }),
  ]);
}

// ── Image-led body slides (what / key points / why) ──────────────────────────

// Fraction of the slide height reserved for the text block at the bottom — the
// heavily-scrimmed zone where the eyebrow + bullets stay legible over the image.
const CONTENT_TEXT_ZONE = 0.46;

// The bottom text block for an image-led body slide: the eyebrow + its content
// (a single lede for "what"; up to three auto-fit bullets for "key points" /
// "why"), then a caption identifying the licensed image — the entity NAME (e.g.
// "Brownstone Productions") plus a "Photo: …" credit. Attribution is mandatory
// (never show a licensed photo without crediting it), and the name gives the
// otherwise-unlabelled logo/photo context.
function contentBody({ kind, story, accent, size, height, whyItMatters, imageName, credit }) {
  const headline = oneLine(story?.headline) || "Today's news quiz";
  const captionLines = [];
  if (imageName) {
    captionLines.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.024), fontWeight: 700, color: FG, marginTop: Math.round(size * 0.022) } }, imageName));
  }
  if (credit) {
    captionLines.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.02), color: MUTED, marginTop: Math.round(size * (imageName ? 0.004 : 0.022)) } }, `Photo: ${credit}`));
  }
  const caption = captionLines.length ? el("div", { style: { display: "flex", flexDirection: "column" } }, captionLines) : null;
  const wrap = (children) => el("div", { style: { display: "flex", flexDirection: "column" } }, caption ? [...children, caption] : children);

  if (kind === "what") {
    // A single lede sentence (not a paragraph), large type — skimmable over the
    // image; the key-points slide carries the detail.
    const summary = firstSentences(story?.summary, 1) || headline;
    return wrap([
      eyebrow("What happened", accent, size),
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.052), color: FG, lineHeight: 1.4 } }, summary),
    ]);
  }

  // "Key points" (today's key_points) and "Why it matters" (historical points
  // passed in via whyItMatters) share one bullet layout, with a summary fallback.
  const label = kind === "why" ? "Why it matters" : "Key points";
  const points = (kind === "why"
    ? (Array.isArray(whyItMatters) ? whyItMatters.filter(Boolean) : [])
    : keyPoints(story)).slice(0, 3);
  if (!points.length) {
    return wrap([
      eyebrow(label, accent, size),
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.04), color: FG, lineHeight: 1.3 } }, firstSentences(story?.summary, 2) || headline),
    ]);
  }
  // Fit the bullets to the scrimmed lower zone, minus the eyebrow and the caption.
  const budget = height * CONTENT_TEXT_ZONE - size * 0.054 - (caption ? size * 0.06 : 0);
  const fit = fitBulletSlide(points, size, budget);
  return wrap([eyebrow(label, accent, size), ...fit.points.map((p) => bulletRow(p, accent, size, fit.fontPx))]);
}

// An image-led body slide: the same FULL-BLEED treatment as the cover — a photo
// covers the frame (logo contained on the gradient floor, gradient alone when
// there's no image) under a legibility scrim, with the brand chrome on top, the
// text anchored low in the scrimmed zone, and the page indicator in the footer.
function contentSlideTree({ kind, story, accent, category, index, total, size, height, slideImage, whyItMatters }) {
  const padX = Math.round(size * PAD_X_RATIO);
  const padY = Math.round(size * PAD_Y_RATIO);
  // Illustrations carry no name/credit (not a licensed photo); entity photos do.
  const credit = oneLine(slideImage?.credit);
  const imageName = oneLine(slideImage?.name);
  const foreground = el("div", {
    style: {
      position: "relative", width: size, height, display: "flex", flexDirection: "column",
      justifyContent: "space-between", padding: `${padY}px ${padX}px`, fontFamily: "Lato",
    },
  }, [
    slideHeader({ category, accent, size }),
    el("div", { style: { display: "flex", flexGrow: 1, flexDirection: "column", justifyContent: "flex-end" } }, [
      contentBody({ kind, story, accent, size, height, whyItMatters, imageName, credit }),
    ]),
    slideFooter({ accent, size, index, total, hint: "" }),
  ]);
  return el("div", {
    style: { position: "relative", display: "flex", width: size, height, backgroundColor: BG, fontFamily: "Lato" },
  }, [...slideBackground({ image: slideImage, accent, size, height }), contentScrim(size, height), foreground]);
}

// The cover slide — its own FULL-BLEED layout (vs slideTree's padded card). The
// editorial image fills the frame; a bottom-weighted scrim guarantees the hook
// reads over any image; the bold, keyword-highlighted hook is anchored at the
// bottom with the brand wordmark/category on top and a source line — matching
// the craft of top faceless-news carousels (e.g. @vesting). `portrait` is the
// already-resolved cover image ({ dataUri, ... }) or null (→ category-gradient
// fallback, so the cover is never bare).
function coverTree({ story, accent, category, size, height, portrait, coverHook, coverHighlight, highlightMode = HIGHLIGHT_MODE }) {
  const padX = Math.round(size * PAD_X_RATIO);
  const padY = Math.round(size * PAD_Y_RATIO);
  // Prefer the concrete upstream hook; fall back to the raw headline. The
  // highlight belongs to the HOOK, so it is dropped on the headline fallback.
  const hookText = oneLine(coverHook);
  const cover = hookText || oneLine(story?.headline) || "Today's news quiz";
  const source = coverSource(story);

  // Layer 1 — full-bleed background: the editorial image (a photo COVERS the
  // frame, biased to the upper third so a face survives the scrim; an org logo is
  // CONTAINED on the gradient so a wordmark isn't cropped/zoomed), else the
  // category-accent gradient floor so a post is never bare.
  const background = slideBackground({ image: portrait, accent, size, height, photoPosition: "center 28%" });

  // Layer 2 — legibility scrim (transparent at top → near-opaque BG at bottom).
  const scrim = el("div", {
    style: {
      position: "absolute", top: 0, left: 0, display: "flex", width: size, height,
      backgroundImage: "linear-gradient(180deg, rgba(11,15,26,0) 16%, rgba(11,15,26,0.30) 40%, rgba(11,15,26,0.72) 62%, rgba(11,15,26,0.95) 100%)",
    },
  }, []);

  // Layer 3 — top chrome over the image: brand wordmark + category chip.
  const topChrome = el("div", {
    style: { position: "absolute", top: padY, left: padX, right: padX, display: "flex", alignItems: "center", justifyContent: "space-between" },
  }, brandMarks({ category, accent, size }));

  // Attribution for the bottom-left slot. A licensed cover PHOTO (Wikipedia /
  // editorial override) MUST carry its credit — never render one without telling
  // the viewer where it came from (migration_data_quality_p2_5). An illustration
  // or the gradient floor has no photo credit, so fall back to the news source.
  const credit = oneLine(portrait?.credit);
  const attribution = credit ? `Photo: ${credit}` : (source ? `via ${source}` : "");

  // Layer 4 — bottom content: date eyebrow, the hook, then an attribution + swipe row.
  const bottomChildren = [];
  const dateRow = coverDateRow(story, size);
  if (dateRow) bottomChildren.push(dateRow);
  bottomChildren.push(coverHeadline(cover, size, { highlight: hookText ? coverHighlight : "", mode: highlightMode, accent }));
  const metaRow = [];
  if (attribution) metaRow.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.024), fontWeight: 700, color: MUTED, letterSpacing: 1 } }, attribution));
  metaRow.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.026), color: FG, marginLeft: "auto" } }, "Swipe to read →"));
  bottomChildren.push(el("div", {
    style: { display: "flex", alignItems: "center", width: "100%", marginTop: Math.round(size * 0.03) },
  }, metaRow));
  const bottom = el("div", {
    style: { position: "absolute", bottom: padY, left: padX, right: padX, display: "flex", flexDirection: "column" },
  }, bottomChildren);

  return el("div", {
    style: { position: "relative", display: "flex", width: size, height, backgroundColor: BG, fontFamily: "Lato" },
  }, [...background, scrim, topChrome, bottom]);
}

// Render the full Instagram carousel as ordered JPEG slides. Defaults to JPEG
// because the Instagram Graph API rejects non-JPEG media containers.
//
// When `withPortrait` is on, the cover slide gains a large licensed image of the
// lead entity (person, else org/place) with a credit. Resolving the image is
// best-effort and happens once up front; any failure leaves the cover text-only.
// `fetchImpl` is injectable for tests.
export async function renderCarouselSlides(story, { format = "jpeg", slides, withPortrait = false, whyItMatters = [], question = null, coverHook = null, coverHighlight = null, highlightMode = HIGHLIGHT_MODE, illustrationUrls = [], fetchImpl } = {}) {
  const { width, height } = SHAPES.portrait;
  const size = width; // scaling base for typography/padding; height adds 4:5 room
  const accent = accentFor(story?.category_id);
  const category = oneLine(story?.category_id || "news");
  const fonts = await loadFonts();
  // Default slide set depends on whether historical "why it matters" points were
  // supplied (the "why" slide is dropped when empty) and whether an engagement
  // MCQ was supplied (the "engagement" slide is dropped when absent). An explicit
  // `slides` wins.
  const slideList = slides || carouselSlidesFor(whyItMatters, question);
  const total = slideList.length;

  // Resolve real imagery once, up front, and spread it across the carousel. Each
  // content slide gets its OWN visual, best-effort and in parallel. The COVER is
  // sourced strictly: a lead PERSON photo, else an editorial illustration, else
  // (last resort) a CONTAINED org logo / place image, else the gradient floor — so
  // a logo or country flag never heroes the cover above an illustration, and never
  // bleeds full-frame. Body slides take any other entity image, captioned. Gated
  // by withPortrait.
  let portrait = null;
  const bodyImageByKind = {};
  // What the COVER ended up showing: "photo" (licensed person photo), "illustration"
  // (Tier-2 generated), "logo" (a contained org/place last resort), or "none" (the
  // gradient floor). Surfaced on the cover slide so the generator can HOLD a weak
  // cover (logo/none) for review instead of auto-posting it. Left undefined when
  // imagery is disabled (withPortrait off) — then the generator never gates on it.
  let coverImagery;
  if (withPortrait) {
    const contentKinds = ["cover", "what", "keypoints", "why"].filter((k) => slideList.includes(k));
    // planEntityImagery is the single source of truth for cover/body sourcing —
    // shared with plannedIllustrationCount so the generated illustration count can't
    // drift from this allocation. The cover photo is a lead PERSON only; the lead
    // org/place is reserved as the cover's last resort (Pass 3) and kept off the
    // body slides so the same logo never appears on both.
    const { hasCover, coverSpec, coverFallbackSpec, bodyKinds, bodySpecs } = planEntityImagery(story, contentKinds);
    const specByKind = {};
    if (hasCover) specByKind.cover = coverSpec;
    bodyKinds.forEach((k, i) => { specByKind[k] = bodySpecs[i] || null; });

    // Pass 1 — resolve the licensed photo for each slide (best-effort, parallel).
    const photoByKind = {};
    await Promise.all(contentKinds.map(async (k) => {
      const photo = await resolveImage(specByKind[k], fetchImpl);
      if (photo) photoByKind[k] = photo;
    }));

    // Pass 2 — route the supplied illustrations to the photo-less slides, in slide
    // order. The cover is first, so it claims an illustration BEFORE any org/place
    // fallback. The generator sizes the set (plannedIllustrationCount) so every
    // gap — the cover included when it has no person photo — gets a distinct one.
    const ill = (Array.isArray(illustrationUrls) ? illustrationUrls : []).filter(Boolean);
    const gapKinds = contentKinds.filter((k) => !photoByKind[k]);
    const illByKind = {};
    await Promise.all(gapKinds.map(async (k, i) => {
      if (!ill[i]) return;
      const dataUri = await fetchImageDataUri(ill[i], fetchImpl ? { fetchImpl } : {});
      if (dataUri) illByKind[k] = { dataUri }; // illustration — no caption (not a photo)
    }));

    // Pass 3 — LAST resort for the COVER only: still no photo and no illustration →
    // the first org/place entity image, CONTAINED (so a logo/flag isn't blown up
    // full-bleed). Body slides without imagery keep the gradient floor.
    let coverFallback = null;
    if (hasCover && !photoByKind.cover && !illByKind.cover && coverFallbackSpec) {
      const resolved = await resolveImage(coverFallbackSpec, fetchImpl);
      if (resolved) coverFallback = { ...resolved, contain: true };
    }

    for (const k of contentKinds) {
      const img = photoByKind[k] || illByKind[k] || (k === "cover" ? coverFallback : null);
      if (!img) continue;
      if (k === "cover") portrait = img; else bodyImageByKind[k] = img;
    }

    if (hasCover) {
      coverImagery = photoByKind.cover ? "photo"
        : illByKind.cover ? "illustration"
        : coverFallback ? "logo"
        : "none";
    }
  }

  const out = [];
  for (let index = 0; index < slideList.length; index++) {
    const kind = slideList[index];
    // The cover gets its own full-bleed layout; every other slide is a padded
    // text card via slideTree.
    const tree = kind === "cover"
      ? coverTree({ story, accent, category, size, height, portrait, coverHook, coverHighlight, highlightMode })
      : (kind === "what" || kind === "keypoints" || kind === "why")
        ? contentSlideTree({ kind, story, accent, category, index, total, size, height, slideImage: bodyImageByKind[kind] || null, whyItMatters })
        : slideTree({ kind, accent, category, index, total, size, height, question: kind === "engagement" ? question : null });
    const svg = await satori(tree, { width, height, fonts });
    const { buffer, contentType } = rasterize(svg, { width, format });
    out.push({ buffer, contentType, width, height, slideType: kind, index, ...(kind === "cover" ? { coverImagery } : {}) });
  }
  return out;
}

export { SHAPES, CAROUSEL_SLIDES, coverDateLine };
