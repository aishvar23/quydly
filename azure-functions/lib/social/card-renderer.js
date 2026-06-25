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
import { teamAccent } from "./club-colors.js";
import { formPoints } from "./football-data.js";
import { pickBackground, moodForMatch, backgroundCredit } from "./football-backgrounds.js";

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
  // 9:16 — the Reels frame format. Same 1080 width (so all type/padding ratios
  // carry over) with a taller canvas; football slides render natively at this
  // size as video frames.
  portrait916: { width: 1080, height: 1920 },
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
  // Anton is the condensed, heavy display face (SIL OFL) used by the football
  // carousel for hero numerals (scores, stats) and uppercase headers — the
  // "sports-broadcast grotesque" look. Best-effort: if it is missing, the
  // football builders fall back to Lato Bold (Satori substitutes the family).
  const [regular, bold, anton] = await Promise.all([
    readFile(join(FONT_DIR, "Lato-Regular.ttf")),
    readFile(join(FONT_DIR, "Lato-Bold.ttf")),
    readFile(join(FONT_DIR, "Anton-Regular.ttf")).catch(() => null),
  ]);
  _fonts = [
    { name: "Lato", data: regular, weight: 400, style: "normal" },
    { name: "Lato", data: bold, weight: 700, style: "normal" },
  ];
  if (anton) _fonts.push({ name: "Anton", data: anton, weight: 400, style: "normal" });
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

// How many DISTINCT usable entity images the story has (sensitivity-aware). The
// generator sizes illustration generation from this so that EVERY content slide
// without a photo gets a real illustration instead of the brand-graphic floor:
// it generates (content-slide count − usable photos) illustrations, which the
// renderer routes to exactly the photo-less slides.
export function usableImageCount(story) {
  return entityImages(story).length;
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

// ── Football carousel (FIFA/soccer variant) ──────────────────────────────────
//
// A football-only, full-bleed, data-true carousel that replaces the standard
// body slides for resolved matches. Driven by a `football` context object from
// lib/social/football-data.js (sourced from football-data.org — we render ONLY
// sourced numbers; never a fabricated score/table/probability). All four slides
// share fullBleedSlideTree so the set reads as one cinematic template with a
// single changing team accent. See .claude/agents/ig-fifa-sme.md for the system.

// Result-pill semantics — a fixed industry convention (BBC/FotMob/Sofascore):
// Win = green, Draw = grey, Loss = red. Do not repurpose for decoration.
const FB_WIN = "#22C55E";
const FB_DRAW = "#9CA3AF";
const FB_LOSS = "#EF4444";
// League-zone left-edge bars: Champions League green, Europa blue, relegation red.
const FB_ZONE_CL = "#22C55E";
const FB_ZONE_EL = "#3B82F6";
const FB_ZONE_REL = "#EF4444";
// A FIXED bright accent for football TEXT emphasis (eyebrows, the follow handle).
// Team-accent text on a same-hue gradient background washes out, so per the §2
// rule the accent stays on slivers (bars/badges/rows) and bright text emphasis
// uses this yellow, which reads on any team-color gradient.
const FB_BRIGHT = HIGHLIGHT_MARKER;

const FOOTBALL_SLIDES = ["cover", "scoreboard", "table", "form", "stat-insights", "cta"];

// The football slide list when a match resolved; otherwise the standard set. The
// Form slide is DROPPED when neither involved team has a usable last-5 `form`
// string (e.g. early World Cup group stage), since an empty form slide reads as
// broken — a wrong-looking real post is worse than one fewer slide.
function footballSlidesFor(football) {
  if (!football) return null;
  const rows = football.standings?.table || [];
  const involved = football.standings?.involved || [];
  const hasForm = rows.some((r) => r.involved && r.form && String(r.form).trim())
    || involved.some((r) => r.form && String(r.form).trim());
  // A cup/knockout/friendly match returns no league table → drop the Table slide
  // (it would render a header-only "STANDINGS" card). Same for an empty insights
  // set (the climax slide would be a bare fallback line).
  const hasTable = rows.length >= 2;
  const hasInsights = (football.insights?.lines || []).length > 0;
  let list = FOOTBALL_SLIDES;
  if (!hasForm) list = list.filter((k) => k !== "form");
  if (!hasTable) list = list.filter((k) => k !== "table");
  if (!hasInsights) list = list.filter((k) => k !== "stat-insights");
  return list;
}

// Only raster data URIs (png/jpeg/webp) render reliably in Satori; crest URLs are
// often SVG, which we skip in favour of a clean monogram badge fallback.
function isRasterDataUri(s) {
  return typeof s === "string" && /^data:image\/(png|jpe?g|webp)/i.test(s);
}

// A team badge: the licensed crest when it is a raster image, else a monogram
// disc in the team accent (the TLA/short name) — so a badge always renders.
function teamBadge({ team, accent, crest, diameter }) {
  const d = diameter;
  if (isRasterDataUri(crest)) {
    return el("img", { src: crest, width: d, height: d, style: { width: d, height: d, objectFit: "contain" } });
  }
  const label = oneLine(team?.tla || team?.shortName || team?.name || "").slice(0, 3).toUpperCase();
  return el("div", {
    style: {
      display: "flex", width: d, height: d, borderRadius: 999, alignItems: "center", justifyContent: "center",
      backgroundColor: accent, color: pickTextOn(accent), fontFamily: "Anton",
      fontSize: Math.round(d * 0.42), letterSpacing: 1,
    },
  }, label);
}

// Choose black/white text for legibility on a given accent (rough luminance).
function pickTextOn(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? "#0B0F1A" : "#FFFFFF";
}

// The shared full-bleed scaffold for the four football slides: a full-frame
// background, a two-way legibility scrim, top chrome (brand + category chip), the
// centred body, and a footer carrying the open-loop teaser + page counter.
function fullBleedSlideTree({ size, height, accent, category, background, body, teaser, credit, index, total }) {
  const padX = Math.round(size * PAD_X_RATIO);
  const padY = Math.round(size * PAD_Y_RATIO);
  const scrim = el("div", {
    style: {
      position: "absolute", top: 0, left: 0, display: "flex", width: size, height,
      backgroundImage: "linear-gradient(180deg, rgba(11,15,26,0.55) 0%, rgba(11,15,26,0.30) 26%, rgba(11,15,26,0.55) 60%, rgba(11,15,26,0.92) 100%)",
    },
  }, []);
  const topChrome = el("div", {
    style: { position: "absolute", top: padY, left: padX, right: padX, display: "flex", alignItems: "center", justifyContent: "space-between" },
  }, brandMarks({ category, accent, size }));
  const main = el("div", {
    style: {
      position: "absolute", left: padX, right: padX, top: Math.round(size * 0.18), bottom: Math.round(size * 0.13),
      display: "flex", flexDirection: "column", justifyContent: "center",
    },
  }, body);
  // Left footer stack: the open-loop teaser, plus a small photo credit when the
  // background is a licensed stock photo (Pexels API guideline).
  const leftStack = [el("div", { style: { display: "flex", fontSize: Math.round(size * 0.026), color: "rgba(255,255,255,0.78)", fontWeight: 700 } }, teaser || "")];
  if (credit) {
    leftStack.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.016), color: "rgba(255,255,255,0.55)", marginTop: Math.round(size * 0.008) } }, credit));
  }
  const footer = el("div", {
    style: { position: "absolute", bottom: padY, left: padX, right: padX, display: "flex", alignItems: "flex-end", justifyContent: "space-between" },
  }, [
    el("div", { style: { display: "flex", flexDirection: "column" } }, leftStack),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.024), color: MUTED } }, `${index + 1} / ${total}`),
  ]);
  return el("div", {
    style: { position: "relative", display: "flex", width: size, height, backgroundColor: BG, fontFamily: "Lato" },
  }, [background, scrim, topChrome, main, footer]);
}

// The full-frame background element: a resolved photo (heroBg), else the
// competition emblem floated over a team-accent gradient, else the gradient.
function footballBackground({ size, height, heroBg, emblem, accent }) {
  if (isRasterDataUri(heroBg)) {
    return el("img", {
      src: heroBg, width: size, height,
      style: { position: "absolute", top: 0, left: 0, width: size, height, objectFit: "cover", objectPosition: "center 30%" },
    });
  }
  const gradient = el("div", {
    style: {
      position: "absolute", top: 0, left: 0, display: "flex", width: size, height,
      backgroundImage: `linear-gradient(150deg, ${shade(accent, 18)}, ${shade(accent, -86)})`,
    },
  }, []);
  if (!isRasterDataUri(emblem)) return gradient;
  // Emblem watermark, large and low-opacity, centred — keeps the slide imagery-rich.
  return el("div", { style: { position: "absolute", top: 0, left: 0, display: "flex", width: size, height } }, [
    gradient,
    el("div", {
      style: { position: "absolute", top: 0, left: 0, width: size, height, display: "flex", alignItems: "center", justifyContent: "center" },
    }, [
      el("img", { src: emblem, width: Math.round(size * 0.62), height: Math.round(size * 0.62), style: { width: Math.round(size * 0.62), height: Math.round(size * 0.62), objectFit: "contain", opacity: 0.16 } }),
    ]),
  ]);
}

// Slide 2 — SCOREBOARD: [badge] H – A [badge], FT pill, scorers (mirrored).
function footballScoreboard(fb, { size, img }) {
  const m = fb.match;
  const hAcc = teamAccent(m.home.name);
  const aAcc = teamAccent(m.away.name);
  const d = Math.round(size * 0.2);
  const scoreH = Number.isFinite(m.score.home) ? String(m.score.home) : "–";
  const scoreA = Number.isFinite(m.score.away) ? String(m.score.away) : "–";
  const scoreStyle = { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.26), color: FG, lineHeight: 1 };
  const nameStyle = { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.05), color: FG, marginTop: Math.round(size * 0.018), letterSpacing: 1 };
  const teamCol = (team, acc, crest) => el("div", {
    style: { display: "flex", flexDirection: "column", alignItems: "center", width: Math.round(size * 0.28) },
  }, [
    teamBadge({ team, accent: acc, crest, diameter: d }),
    el("div", { style: nameStyle }, oneLine(team.shortName || team.name).toUpperCase()),
  ]);
  const ftPill = el("div", {
    style: {
      display: "flex", alignSelf: "center", backgroundColor: "rgba(255,255,255,0.14)", color: FG,
      fontWeight: 700, fontSize: Math.round(size * 0.028), letterSpacing: 2, padding: "8px 22px", borderRadius: 999,
      marginBottom: Math.round(size * 0.03),
    },
  }, m.status === "FINISHED" ? "FULL TIME" : oneLine(m.status));
  const scorers = (Array.isArray(m.scorers) ? m.scorers : []);
  // The competition is already shown in the top category chip on every football
  // slide, so the scoreboard body leads straight with the FT pill (no duplicate).
  const body = [
    ftPill,
    el("div", { style: { display: "flex", alignItems: "center", justifyContent: "center" } }, [
      teamCol(m.home, hAcc, img?.homeCrest),
      el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", margin: `0 ${Math.round(size * 0.02)}px` } }, [
        el("div", { style: { display: "flex", alignItems: "center" } }, [
          el("div", { style: scoreStyle }, scoreH),
          el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.16), color: MUTED, margin: `0 ${Math.round(size * 0.02)}px` } }, "–"),
          el("div", { style: scoreStyle }, scoreA),
        ]),
      ]),
      teamCol(m.away, aAcc, img?.awayCrest),
    ]),
  ];
  if (scorers.length) {
    body.push(el("div", {
      style: { display: "flex", justifyContent: "center", fontSize: Math.round(size * 0.026), color: "rgba(255,255,255,0.85)", marginTop: Math.round(size * 0.035), flexWrap: "wrap" },
    }, oneLine(scorers.map((s) => `${s.name}${s.minute ? ` ${s.minute}'` : ""}`).join("   ·   "))));
  }
  return body;
}

// Slide 3 — LEAGUE TABLE: Pos · Team · P · GD · Pts. Involved rows highlighted in
// the team accent; zone left-edge bars; tabular figures. No per-row crests (kept
// clean + avoids 20 crest fetches / SVG-in-Satori issues).
function footballTable(fb, { size }) {
  const rows = (fb.standings?.table || []).slice(0, 8);
  const num = (v, w) => el("div", { style: { display: "flex", width: w, justifyContent: "flex-end", fontFamily: "Anton", fontSize: Math.round(size * 0.03), color: FG } }, String(v ?? ""));
  const headerCell = (t, w, align = "flex-end") => el("div", { style: { display: "flex", width: w, justifyContent: align, fontSize: Math.round(size * 0.02), color: MUTED, letterSpacing: 1 } }, t);
  const zoneColor = (pos, comp) => {
    if (comp === "PL" || comp === "PD" || comp === "SA" || comp === "BL1" || comp === "FL1") {
      if (pos <= 4) return FB_ZONE_CL;
      if (pos === 5 || pos === 6) return FB_ZONE_EL;
    }
    if (pos >= 18) return FB_ZONE_REL;
    return "transparent";
  };
  const numW = Math.round(size * 0.085);
  const ptsW = Math.round(size * 0.1);
  const header = el("div", {
    style: { display: "flex", alignItems: "center", padding: `0 0 ${Math.round(size * 0.014)}px 0`, marginBottom: Math.round(size * 0.01) },
  }, [
    el("div", { style: { display: "flex", width: Math.round(size * 0.07) } }, headerCell("#", Math.round(size * 0.07), "flex-start")),
    el("div", { style: { display: "flex", flexGrow: 1 } }, []),
    headerCell("P", numW), headerCell("GD", numW), headerCell("PTS", ptsW),
  ]);
  const body = [
    el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.05), color: FG, letterSpacing: 1, marginBottom: Math.round(size * 0.02) } }, "STANDINGS"),
    header,
  ];
  rows.forEach((r, i) => {
    const acc = teamAccent(r.team?.name);
    const zone = zoneColor(r.position, fb.competition?.code);
    body.push(el("div", {
      style: {
        display: "flex", alignItems: "center", height: Math.round(size * 0.062),
        backgroundColor: r.involved ? hexA(acc, 0.16) : (i % 2 ? "rgba(255,255,255,0.03)" : "transparent"),
        borderLeft: `${Math.round(size * 0.006)}px solid ${r.involved ? acc : zone}`,
        paddingLeft: Math.round(size * 0.018), paddingRight: Math.round(size * 0.006),
      },
    }, [
      el("div", { style: { display: "flex", width: Math.round(size * 0.06), fontFamily: "Anton", fontSize: Math.round(size * 0.028), color: r.involved ? FG : MUTED } }, String(r.position)),
      el("div", { style: { display: "flex", flexGrow: 1, fontSize: Math.round(size * 0.03), fontWeight: r.involved ? 700 : 400, color: FG } }, oneLine(r.team?.shortName || r.team?.name)),
      num(r.played, numW), num(Number.isFinite(r.goalDifference) ? (r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference) : "", numW),
      el("div", { style: { display: "flex", width: ptsW, justifyContent: "flex-end", fontFamily: "Anton", fontSize: Math.round(size * 0.034), color: FG } }, String(r.points ?? "")),
    ]));
  });
  return body;
}

// rgba() from a #rrggbb hex + alpha.
function hexA(hex, a) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// W/D/L pill row (oldest→newest, rightmost = latest). Real `form` string only.
function formPills(form, size) {
  const results = String(form || "").split(/[ ,]+/).filter(Boolean).slice(-5);
  const d = Math.round(size * 0.058);
  return el("div", { style: { display: "flex" } }, results.map((r) => el("div", {
    style: {
      display: "flex", width: d, height: d, borderRadius: Math.round(d * 0.26), alignItems: "center", justifyContent: "center",
      backgroundColor: r === "W" ? FB_WIN : r === "D" ? FB_DRAW : FB_LOSS, color: "#FFFFFF",
      fontFamily: "Anton", fontSize: Math.round(d * 0.5), marginRight: Math.round(size * 0.014),
    },
  }, r)));
}

// Slide 4 — FORM & MOMENTUM: two W/D/L strips + a 2-segment form-points bar
// (W=3/D=1/L=0, home-left/away-right). NO "%", NO probability/odds, NO draw
// segment — every number is the real last-5 form.
function footballForm(fb, { size }) {
  const m = fb.match;
  const involved = fb.standings?.involved || [];
  const findRow = (teamId) => (fb.standings?.table || []).find((r) => r.team?.id === teamId) || involved.find((r) => r.teamId === teamId) || {};
  const hRow = findRow(m.home.id);
  const aRow = findRow(m.away.id);
  const hPts = formPoints(hRow.form);
  const aPts = formPoints(aRow.form);
  const total = hPts + aPts || 1;
  const hAcc = teamAccent(m.home.name);
  const aAcc = teamAccent(m.away.name);
  const teamForm = (team, acc, row) => el("div", { style: { display: "flex", flexDirection: "column", marginBottom: Math.round(size * 0.04) } }, [
    el("div", { style: { display: "flex", alignItems: "center", marginBottom: Math.round(size * 0.016) } }, [
      el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.04), color: FG, letterSpacing: 1, marginRight: "auto" } }, oneLine(team.shortName || team.name).toUpperCase()),
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.024), color: MUTED } }, Number.isFinite(row.position) ? `${ord(row.position)} · ${formPoints(row.form)} pts` : `${formPoints(row.form)} pts`),
    ]),
    formPills(row.form, size),
  ]);
  const barH = Math.round(size * 0.05);
  // A white divider keeps the split legible when the two team accents are close
  // (e.g. two reds). Home-left / away-right, widths ∝ real form points.
  const bar = el("div", { style: { display: "flex", width: "100%", height: barH, borderRadius: Math.round(barH * 0.3), overflow: "hidden", marginTop: Math.round(size * 0.01) } }, [
    el("div", { style: { display: "flex", width: `${Math.round((hPts / total) * 100)}%`, height: barH, backgroundColor: hAcc, borderRight: "3px solid rgba(255,255,255,0.92)" } }, []),
    el("div", { style: { display: "flex", width: `${Math.round((aPts / total) * 100)}%`, height: barH, backgroundColor: aAcc } }, []),
  ]);
  return [
    el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.05), color: FG, letterSpacing: 1, marginBottom: Math.round(size * 0.04) } }, "FORM GUIDE"),
    teamForm(m.home, hAcc, hRow),
    teamForm(m.away, aAcc, aRow),
    bar,
    el("div", { style: { display: "flex", justifyContent: "space-between", marginTop: Math.round(size * 0.014) } }, [
      el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.03), color: FG } }, `${hPts} PTS`),
      el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.03), color: FG } }, `${aPts} PTS`),
    ]),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.02), color: MUTED, marginTop: Math.round(size * 0.02) } }, "Based on last-5 results & league position"),
  ];
}

// Slide 5 — STAT-INSIGHTS / climax reveal: a hero line + grounded bullets, all
// from real numbers in the resolved context.
function footballInsights(fb, { size }) {
  const lines = (fb.insights?.lines || []).slice(0, 3);
  const body = [
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.03), fontWeight: 700, color: FB_BRIGHT, letterSpacing: 2, textTransform: "uppercase", marginBottom: Math.round(size * 0.03) } }, "By the numbers"),
  ];
  if (lines.length) {
    // The climax/aha reveal: the first insight is the hero line (large, condensed);
    // any remaining insights follow as bullets.
    body.push(el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.058), color: FG, lineHeight: 1.08, marginBottom: Math.round(size * 0.035) } }, oneLine(lines[0])));
    lines.slice(1).forEach((l) => body.push(bulletRow(oneLine(l), FB_BRIGHT, size, Math.round(size * 0.036))));
  } else {
    body.push(el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.058), color: FG, lineHeight: 1.08 } }, "The numbers behind the result."));
  }
  body.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.02), color: MUTED, marginTop: "auto", paddingTop: Math.round(size * 0.04) } }, "Data: football-data.org"));
  return body;
}

// CTA tuned for the football carousel — Save first (the retention signal), then
// the follow handle.
function footballCtaBody(size) {
  return [
    el("div", { style: { display: "flex", fontFamily: "Anton", fontSize: Math.round(size * 0.062), color: FG, letterSpacing: 1, marginBottom: Math.round(size * 0.02) } }, "SAVE THIS FOR MATCHDAY"),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.034), color: "rgba(255,255,255,0.82)", marginBottom: Math.round(size * 0.04), lineHeight: 1.35 } }, "Tap save, then follow for the next one — results, tables & form, decoded."),
    // Bright (not team-accent) so the handle reads on any team-color gradient.
    el("div", { style: { display: "flex", color: FB_BRIGHT, fontWeight: 700, fontSize: Math.round(size * 0.05) } }, QUYDLY_IG_HANDLE()),
  ];
}

function ord(n) {
  if (!Number.isFinite(n)) return String(n);
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Deterministic open-loop teaser shown on the footer of each non-final slide.
function footballTeaser(nextKind) {
  switch (nextKind) {
    case "scoreboard": return "Next: the full-time score →";
    case "table": return "Next: what it did to the table →";
    case "form": return "Next: who's actually in form →";
    case "stat-insights": return "Next: the number that decided it →";
    case "cta": return "";
    default: return "";
  }
}

// Build one football slide tree (cover stays on coverTree; the rest are full-bleed).
// `nextKind` is the ACTUAL following slide in the (possibly form-dropped) list, so
// the open-loop teaser stays correct.
// "Luka Modrić · Photo: Wikipedia" — identifies the player + credits the photo.
function playerCredit(p) {
  if (!p) return null;
  return `${p.name ? oneLine(p.name) + " · " : ""}Photo: ${p.credit || "Wikipedia"}`;
}

function footballSlideTree({ kind, football, accent, category, index, total, size, height, img, nextKind }) {
  const teaser = footballTeaser(nextKind);
  const players = img?.players || [];
  // Hero slides (scoreboard, stat-insights) lead with a real player FACE — the
  // emotional driver. Data-dense table/form stay on the cleaner generic stock so
  // the rows read. Fall back to stock, then emblem/gradient, when no face exists.
  let bgUri = null;
  let credit = null;
  if (kind === "scoreboard" && players[0]) { bgUri = players[0].dataUri; credit = playerCredit(players[0]); }
  else if (kind === "stat-insights" && (players[1] || players[0])) { const p = players[1] || players[0]; bgUri = p.dataUri; credit = playerCredit(p); }
  if (!bgUri && isRasterDataUri(img?.stockBg)) { bgUri = img.stockBg; credit = img?.stockCredit; }
  const background = footballBackground({ size, height, heroBg: bgUri, emblem: img?.emblem, accent: teamAccent(football.match.home.name) });
  let body;
  if (kind === "scoreboard") body = footballScoreboard(football, { size, img });
  else if (kind === "table") body = footballTable(football, { size });
  else if (kind === "form") body = footballForm(football, { size });
  else if (kind === "stat-insights") body = footballInsights(football, { size });
  else body = footballCtaBody(size); // cta
  return fullBleedSlideTree({ size, height, accent, category, background, body, teaser, credit: isRasterDataUri(bgUri) ? credit : null, index, total });
}

// Render the full Instagram carousel as ordered JPEG slides. Defaults to JPEG
// because the Instagram Graph API rejects non-JPEG media containers.
//
// When `withPortrait` is on, the cover slide gains a large licensed image of the
// lead entity (person, else org/place) with a credit. Resolving the image is
// best-effort and happens once up front; any failure leaves the cover text-only.
// `fetchImpl` is injectable for tests.
export async function renderCarouselSlides(story, { format = "jpeg", shape = "portrait", slides, withPortrait = false, whyItMatters = [], question = null, coverHook = null, coverHighlight = null, highlightMode = HIGHLIGHT_MODE, illustrationUrls = [], football = null, fetchImpl } = {}) {
  const { width, height } = SHAPES[shape] || SHAPES.portrait;
  const size = width; // scaling base for typography/padding; height adds 4:5 (or 9:16) room
  // For a resolved football match the chrome accent is the home team's color and
  // the category chip is the competition name; otherwise the category accent/id.
  const accent = football ? teamAccent(football.match.home.name) : accentFor(story?.category_id);
  const category = football ? oneLine(football.competition?.name || "football") : oneLine(story?.category_id || "news");
  const fonts = await loadFonts();
  // A resolved football match selects the football slide set (cover + scoreboard
  // /table/form/stat-insights + cta); otherwise the standard set. An explicit
  // `slides` wins over both.
  const slideList = slides || footballSlidesFor(football) || carouselSlidesFor(whyItMatters, question);
  const total = slideList.length;

  // Football imagery: the two crests, the competition emblem, and a generic
  // full-bleed background by result mood. All best-effort (raster only — SVG
  // crests fall back to monogram badges). Resolved once, up front.
  let fbImg = null;
  if (football) {
    const opt = fetchImpl ? { fetchImpl } : {};
    const bg = await pickBackground({ mood: moodForMatch(football, "scoreboard"), competition: football.competition?.code, seed: football.match?.id || 0 }).catch(() => null);
    // Real player FACES from the story's LICENSED entity enrichment (Wikipedia /
    // editor overrides) — the emotional drive. Hero slides lead with a player
    // face; generic stock is only the fallback when no licensed face exists.
    const playerSpecs = entityImages(story);
    const [crestsAndBg, players] = await Promise.all([
      Promise.all([
        football.match.home.crest ? fetchImageDataUri(football.match.home.crest, opt) : null,
        football.match.away.crest ? fetchImageDataUri(football.match.away.crest, opt) : null,
        football.competition?.emblemUrl ? fetchImageDataUri(football.competition.emblemUrl, opt) : null,
        bg?.url ? fetchImageDataUri(bg.url, opt) : null,
      ]),
      Promise.all(playerSpecs.slice(0, 4).map((s) => resolveImage(s, fetchImpl))),
    ]);
    const [homeCrest, awayCrest, emblem, stockBg] = crestsAndBg;
    fbImg = {
      homeCrest, awayCrest, emblem,
      stockBg, stockCredit: stockBg ? backgroundCredit(bg) : null,
      players: players.filter(Boolean), // [{ dataUri, name, credit }]
    };
  }

  // Resolve real imagery once, up front, and spread it across the carousel: the
  // cover gets the lead entity (face-first, with the no-wrong-face guard); the
  // text body slides ("what"/"key points"/"why" that are present) each get a
  // DIFFERENT story entity's image, captioned. All best-effort and in parallel —
  // any miss leaves that slide text-only. Gated by withPortrait.
  let portrait = null;
  const bodyImageByKind = {};
  if (withPortrait || football) {
    // Each cover/text slide gets its OWN visual: a licensed entity photo when one
    // is available, else a generated illustration (Tier 2) that FILLS the gap,
    // else (in slideBody / coverTree) the brand-graphic floor.
    const contentKinds = ["cover", "what", "keypoints", "why"].filter((k) => slideList.includes(k));
    const coverSpec = slideList.includes("cover") ? leadCoverImage(story) : null;
    const bodyKinds = contentKinds.filter((k) => k !== "cover");
    const bodySpecs = entityImages(story).filter((s) => s.name !== coverSpec?.name).slice(0, bodyKinds.length);
    const specByKind = {};
    if (slideList.includes("cover")) specByKind.cover = coverSpec;
    bodyKinds.forEach((k, i) => { specByKind[k] = bodySpecs[i] || null; });

    // Pass 1 — resolve the licensed photo for each slide (best-effort, parallel).
    const photoByKind = {};
    await Promise.all(contentKinds.map(async (k) => {
      const photo = await resolveImage(specByKind[k], fetchImpl);
      if (photo) photoByKind[k] = photo;
    }));

    // Pass 2 — route the supplied illustrations to the slides that ended up
    // WITHOUT a photo, in slide order. The generator sizes the illustration set
    // to the photo-less slides (usableImageCount), so each gap gets a distinct
    // illustration and no content slide falls back to the brand-graphic floor.
    const ill = (Array.isArray(illustrationUrls) ? illustrationUrls : []).filter(Boolean);
    const gapKinds = contentKinds.filter((k) => !photoByKind[k]);
    const illByKind = {};
    await Promise.all(gapKinds.map(async (k, i) => {
      if (!ill[i]) return;
      const dataUri = await fetchImageDataUri(ill[i], fetchImpl ? { fetchImpl } : {});
      if (dataUri) illByKind[k] = { dataUri }; // illustration — no caption (not a photo)
    }));

    for (const k of contentKinds) {
      const img = photoByKind[k] || illByKind[k] || null;
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
      : football
        ? footballSlideTree({ kind, football, accent, category, index, total, size, height, img: fbImg, nextKind: slideList[index + 1] })
        : slideTree({ kind, story, accent, category, index, total, size, height, slideImage: bodyImageByKind[kind] || null, whyItMatters, question: kind === "engagement" ? question : null });
    const svg = await satori(tree, { width, height, fonts });
    const { buffer, contentType } = rasterize(svg, { width, format });
    out.push({ buffer, contentType, width, height, slideType: kind, index });
  }
  return out;
}

export { SHAPES, CAROUSEL_SLIDES, FOOTBALL_SLIDES, footballSlidesFor, coverDateLine };
