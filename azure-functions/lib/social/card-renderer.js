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

function leadCoverImage(story) {
  const ents = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  const pick = (e) => {
    if (!e) return null;
    const urls = entityImageUrls(e);
    return urls.length ? { urls, name: oneLine(e.name), credit: portraitCredit(e) } : null;
  };
  if (!excludePeopleImagery(story)) {
    const leadPerson = pick(ents.find((e) => e && e.type === "person"));
    if (leadPerson) return leadPerson;
  }
  for (const e of ents) {
    if (e && (e.type === "org" || e.type === "place")) {
      const img = pick(e);
      if (img) return img;
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
    out.push({ urls, name: oneLine(e.name), credit: portraitCredit(e) });
  }
  return out;
}

// Whether the story has a USABLE licensed entity image — lets the generator
// decide up front whether to spend an illustration generation (only when there
// is no photo to use). "Usable" is sensitivity-aware: on HIGH-sensitivity
// stories person faces are excluded (excludePeopleImagery), so a tragedy whose
// only image is a person's portrait reports false here and the generator falls
// back to a neutral symbolic illustration instead of leading with that face.
export function hasEntityImage(story) {
  return entityImages(story).length > 0;
}

// Fetch the first of an image spec's candidate URLs that yields a data URI (or
// null). Best-effort — used for both the cover and the body-slide images.
async function resolveImage(spec, fetchImpl) {
  if (!spec) return null;
  for (const url of spec.urls) {
    const dataUri = await fetchImageDataUri(url, fetchImpl ? { fetchImpl } : {});
    if (dataUri) return { dataUri, name: spec.name, credit: spec.credit };
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
// cut-off third point). We size deterministically to fit: step the image and
// bullet font DOWN together through density levels until the estimated bullet
// stack fits the room the image leaves, trimming the points (word boundary, "…")
// only if even the smallest level overflows. Heights are estimated from a
// conservative average glyph advance (Lato ≈ 0.52em) so we err toward NOT
// clipping; short points keep the default size (no regression).
const BULLET_LINE_H = 1.25;
const BULLET_AVG_CHAR_EM = 0.52;
const BULLET_DENSITY = [
  { font: 0.038, image: 0.42 }, // default — unchanged look for short points
  { font: 0.035, image: 0.40 },
  { font: 0.033, image: 0.36 },
  { font: 0.031, image: 0.32 },
  { font: 0.029, image: 0.28 },
];

// Vertical space (px) for the bullet stack once the slide's padding, header,
// footer, eyebrow and the image block (at heightRatio `imageR`) are removed.
// Derived from slideTree geometry (card height = size × 1.25), with a safety
// margin so the estimate never under-counts the chrome.
function bulletStackBudget(size, imageR) {
  const middle = size * 1.25 - 2 * (size * PAD_Y_RATIO) - size * 0.041 - size * 0.049; // − pad − header − footer
  const eyebrowH = size * 0.054;                                    // label + its marginBottom
  const imageBlock = imageR > 0 ? size * imageR + size * 0.075 : 0; // photo + caption + marginBottom
  return middle - eyebrowH - imageBlock - size * 0.02;              // − safety
}

// Estimated stacked height (px) of `points` rendered as bullets at `fontPx`.
function bulletStackHeight(points, fontPx, size) {
  const colW = size * (1 - 2 * PAD_X_RATIO) - (16 + 22); // text column minus the dot + its right margin
  const cpl = Math.max(8, colW / (fontPx * BULLET_AVG_CHAR_EM));
  let h = 0;
  for (const p of points) h += Math.max(1, Math.ceil(p.length / cpl)) * fontPx * BULLET_LINE_H + 22;
  return h;
}

// Pick the densest-that-fits layout for a bullet slide. Returns
// { fontPx, imageRatio, points }; points are trimmed only as a last resort.
function fitBulletSlide(points, size) {
  for (const level of BULLET_DENSITY) {
    const fontPx = Math.round(size * level.font);
    if (bulletStackHeight(points, fontPx, size) <= bulletStackBudget(size, level.image)) {
      return { fontPx, imageRatio: level.image, points };
    }
  }
  // Smallest level still overflows → trim each point to its share of the budget,
  // on a word boundary, with an ellipsis (clean cut, not an IG clip).
  const last = BULLET_DENSITY[BULLET_DENSITY.length - 1];
  const fontPx = Math.round(size * last.font);
  const budget = bulletStackBudget(size, last.image);
  const colW = size * (1 - 2 * PAD_X_RATIO) - 38;
  const cpl = Math.max(8, colW / (fontPx * BULLET_AVG_CHAR_EM));
  const linesEach = Math.max(1, Math.floor((budget / points.length - 22) / (fontPx * BULLET_LINE_H)));
  const maxChars = Math.max(40, Math.floor(linesEach * cpl));
  const trimmed = points.map((p) => (p.length <= maxChars ? p : `${p.slice(0, maxChars).replace(/\s+\S*$/, "").trim()}…`));
  return { fontPx, imageRatio: last.image, points: trimmed };
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

// A rounded photo (a licensed entity image) with a name + "Photo: …" credit
// beneath. The cover uses a large hero (heightRatio 0.46); body slides reuse it
// smaller (≈0.3) to spread real imagery across the carousel without crowding the
// text. This is the slide's main visual, so non-person stories with an org/place
// image read as graphic, not bland.
function imageHero({ image, size, widthRatio = 1, heightRatio = 0.46, marginRatio = 0.038 }) {
  const fullW = Math.round(size * (1 - 2 * PAD_X_RATIO));
  const photoW = Math.round(fullW * widthRatio);
  const photoH = Math.round(size * heightRatio);
  const caption = [];
  if (image.name) {
    caption.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.026), fontWeight: 700, color: FG } }, image.name));
  }
  if (image.credit) {
    caption.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.018), color: MUTED, marginLeft: "auto" } }, `Photo: ${image.credit}`));
  }
  const children = [
    el("img", {
      src: image.dataUri, width: photoW, height: photoH,
      // objectPosition biases the crop toward the upper third so headshots keep
      // the face (a centred crop on a tall portrait decapitates it).
      style: { width: photoW, height: photoH, objectFit: "cover", objectPosition: "center 25%", borderRadius: Math.round(size * 0.028) },
    }),
  ];
  if (caption.length) {
    children.push(el("div", {
      style: { display: "flex", alignItems: "center", width: photoW, marginTop: Math.round(size * 0.016) },
    }, caption));
  }
  // A sub-full-width image is centred in the slide.
  const center = widthRatio < 1 ? { marginLeft: "auto", marginRight: "auto" } : {};
  return el("div", { style: { display: "flex", flexDirection: "column", width: photoW, ...center, marginBottom: Math.round(size * marginRatio) } }, children);
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

// The guaranteed-imagery FLOOR: a designed brand graphic for slides with no
// licensed photo, so a card is NEVER bare text. A category-accent diagonal
// gradient with soft rings and the category label — honest (clearly a Quydly
// graphic, not a fake news photo) and always available. `seed` (the slide index)
// rotates the gradient so a photoless story's slides aren't identical blocks.
function brandGraphic({ category, accent, size, seed = 0, widthRatio = 1, heightRatio = 0.46, marginRatio = 0.038 }) {
  const fullW = Math.round(size * (1 - 2 * PAD_X_RATIO));
  const w = Math.round(fullW * widthRatio);
  const h = Math.round(size * heightRatio);
  const angle = 110 + (seed % 4) * 35; // vary the gradient per slide
  const center = widthRatio < 1 ? { marginLeft: "auto", marginRight: "auto" } : {};
  return el("div", {
    style: {
      display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
      width: w, height: h, ...center, marginBottom: Math.round(size * marginRatio),
      borderRadius: Math.round(size * 0.028),
      backgroundImage: `linear-gradient(${angle}deg, ${shade(accent, 22)}, ${shade(accent, -78)})`,
    },
  }, [
    el("div", {
      style: { display: "flex", fontSize: Math.round(size * 0.066), fontWeight: 700, color: "#FFFFFF", letterSpacing: 2, textTransform: "uppercase" },
    }, oneLine(category || "news")),
    el("div", {
      style: { display: "flex", fontSize: Math.round(size * 0.019), fontWeight: 700, color: "#FFFFFF", opacity: 0.72, letterSpacing: 4, textTransform: "uppercase", marginTop: Math.round(size * 0.012) },
    }, "Quydly"),
  ]);
}

// Build the inner body for one slide kind. `size` is the square edge length.
// `question` (engagement only) is the MCQ { question, options, correctIndex } or
// null. The "cover" slide is NOT built here — it has its own full-bleed layout
// (coverTree); slideBody covers the padded text body slides only.
function slideBody({ kind, story, accent, size, index = 0, slideImage, whyItMatters, question }) {
  const headline = oneLine(story?.headline) || "Today's news quiz";
  const category = oneLine(story?.category_id || "news");

  // Body slides ("what"/"key points"/"why") get a visual above their text: the
  // resolved entity image when there is one, else the brand-graphic floor — so a
  // body slide is never bare text.
  const withImage = (content, heightRatio = 0.42) => el("div", { style: { display: "flex", flexDirection: "column" } }, [
    (slideImage && slideImage.dataUri)
      ? imageHero({ image: slideImage, size, widthRatio: 0.62, heightRatio, marginRatio: 0.03 })
      : brandGraphic({ category, accent, size, seed: index, widthRatio: 0.62, heightRatio, marginRatio: 0.03 }),
    content,
  ]);

  // "Key points" and "Why it matters" share one layout: an eyebrow + up to three
  // bullets auto-fit to the card (fitBulletSlide shrinks the image + font, and
  // trims only as a last resort), with a summary fallback when no points exist.
  const bulletSlide = (label, points) => {
    if (points.length) {
      const fit = fitBulletSlide(points, size);
      return withImage(el("div", { style: { display: "flex", flexDirection: "column" } }, [
        eyebrow(label, accent, size),
        ...fit.points.map((p) => bulletRow(p, accent, size, fit.fontPx)),
      ]), fit.imageRatio);
    }
    return withImage(el("div", { style: { display: "flex", flexDirection: "column" } }, [
      eyebrow(label, accent, size),
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.04), color: FG, lineHeight: 1.3 } }, firstSentences(story?.summary, 2) || headline),
    ]));
  };

  if (kind === "what") {
    // Density: a single lede sentence (not a paragraph), larger type and line
    // height. News sentences run long, so cutting the COUNT to one — not two — is
    // what actually keeps the slide skimmable; the 4:5 slide carries the rest as
    // whitespace, and the key-points slide picks up the detail.
    const summary = firstSentences(story?.summary, 1) || headline;
    return withImage(el("div", { style: { display: "flex", flexDirection: "column" } }, [
      eyebrow("What happened", accent, size),
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.052), color: FG, lineHeight: 1.4 } }, summary),
    ]));
  }

  if (kind === "keypoints") {
    // Today's key_points (the slide formerly labelled "Why it matters").
    return bulletSlide("Key points", keyPoints(story).slice(0, 3));
  }

  if (kind === "why") {
    // The historical "Why it matters" points (LLM-generated, passed in via
    // whyItMatters). Only included in the set when points exist (see
    // carouselSlidesFor); the summary fallback guards an explicit request.
    return bulletSlide("Why it matters", (Array.isArray(whyItMatters) ? whyItMatters.filter(Boolean) : []).slice(0, 3));
  }

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

// The padded text body slides (what / key points / why / engagement / cta).
// The cover is rendered separately by coverTree (full-bleed), so this only ever
// sees non-cover kinds.
function slideTree({ kind, story, accent, category, index, total, size, height, slideImage, whyItMatters, question }) {
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
      slideBody({ kind, story, accent, size, index, slideImage, whyItMatters, question }),
    ]),
    slideFooter({ accent, size, index, total, hint }),
  ]);
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

  // Layer 1 — full-bleed background: the editorial image, else a category-accent
  // diagonal gradient (the imagery floor) so a post is never bare.
  const background = portrait && portrait.dataUri
    ? el("img", {
        src: portrait.dataUri, width: size, height,
        // Bias the crop toward the upper third so headshots keep the face.
        style: { position: "absolute", top: 0, left: 0, width: size, height, objectFit: "cover", objectPosition: "center 28%" },
      })
    : el("div", {
        style: {
          position: "absolute", top: 0, left: 0, display: "flex", width: size, height,
          backgroundImage: `linear-gradient(135deg, ${shade(accent, 22)}, ${shade(accent, -82)})`,
        },
      }, []);

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
  }, [background, scrim, topChrome, bottom]);
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

  // Resolve real imagery once, up front, and spread it across the carousel: the
  // cover gets the lead entity (face-first, with the no-wrong-face guard); the
  // text body slides ("what"/"key points"/"why" that are present) each get a
  // DIFFERENT story entity's image, captioned. All best-effort and in parallel —
  // any miss leaves that slide text-only. Gated by withPortrait.
  let portrait = null;
  const bodyImageByKind = {};
  if (withPortrait) {
    // Each text/cover slide gets its OWN visual, resolved independently: the
    // licensed entity photo when there is one, else the per-slide generated
    // illustration (Tier 2), else (in slideBody) the brand-graphic floor.
    const contentKinds = ["cover", "what", "keypoints", "why"].filter((k) => slideList.includes(k));
    const coverSpec = slideList.includes("cover") ? leadCoverImage(story) : null;
    const bodyKinds = contentKinds.filter((k) => k !== "cover");
    const bodySpecs = entityImages(story).filter((s) => s.name !== coverSpec?.name).slice(0, bodyKinds.length);
    const specByKind = {};
    if (slideList.includes("cover")) specByKind.cover = coverSpec;
    bodyKinds.forEach((k, i) => { specByKind[k] = bodySpecs[i] || null; });
    const ill = Array.isArray(illustrationUrls) ? illustrationUrls : [];
    const illByKind = {};
    contentKinds.forEach((k, i) => { illByKind[k] = ill[i] || null; });

    const resolved = await Promise.all(contentKinds.map(async (k) => {
      const photo = await resolveImage(specByKind[k], fetchImpl);
      if (photo) return [k, photo];
      if (illByKind[k]) {
        const dataUri = await fetchImageDataUri(illByKind[k], fetchImpl ? { fetchImpl } : {});
        if (dataUri) return [k, { dataUri }]; // illustration — no caption (not a photo)
      }
      return [k, null];
    }));
    for (const [k, img] of resolved) {
      if (!img) continue;
      if (k === "cover") portrait = img; else bodyImageByKind[k] = img;
    }
  }

  const out = [];
  for (let index = 0; index < slideList.length; index++) {
    const kind = slideList[index];
    // The cover gets its own full-bleed layout; every other slide is a padded
    // text card via slideTree.
    const tree = kind === "cover"
      ? coverTree({ story, accent, category, size, height, portrait, coverHook, coverHighlight, highlightMode })
      : slideTree({ kind, story, accent, category, index, total, size, height, slideImage: bodyImageByKind[kind] || null, whyItMatters, question: kind === "engagement" ? question : null });
    const svg = await satori(tree, { width, height, fonts });
    const { buffer, contentType } = rasterize(svg, { width, format });
    out.push({ buffer, contentType, width, height, slideType: kind, index });
  }
  return out;
}

export { SHAPES, CAROUSEL_SLIDES, coverDateLine };
