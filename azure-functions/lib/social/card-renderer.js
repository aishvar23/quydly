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
function leadCoverImage(story) {
  const ents = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  const pick = (e) => {
    if (!e) return null;
    const raw = e.portrait_image_url || e.portrait_thumbnail_url || e.wikipedia_thumbnail_url;
    if (typeof raw !== "string" || !/^https:\/\//i.test(raw)) return null;
    // Wikimedia 400s on a thumbnail wider than the source image (and supported
    // sizes vary per file), so don't upscale blindly: offer a couple of larger
    // renders and fall back to the original URL, which is always valid. The
    // caller tries them in order and takes the first that fetches.
    const urls = [...new Set([upscaleWikimedia(raw, 800), upscaleWikimedia(raw, 500), raw])];
    return { urls, name: oneLine(e.name), credit: portraitCredit(e) };
  };
  const leadPerson = pick(ents.find((e) => e && e.type === "person"));
  if (leadPerson) return leadPerson;
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
  const out = [];
  const seen = new Set();
  for (const e of ents) {
    if (!e || seen.has(e.name)) continue;
    const raw = e.portrait_image_url || e.portrait_thumbnail_url || e.wikipedia_thumbnail_url;
    if (typeof raw !== "string" || !/^https:\/\//i.test(raw)) continue;
    seen.add(e.name);
    out.push({ urls: [...new Set([upscaleWikimedia(raw, 800), upscaleWikimedia(raw, 500), raw])], name: oneLine(e.name), credit: portraitCredit(e) });
  }
  return out;
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
function slideHeader({ category, accent, size }) {
  return el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, [
    el("div", { style: { fontSize: Math.round(size * 0.034), fontWeight: 700, color: FG, letterSpacing: 1 } }, "QUYDLY"),
    el("div", {
      style: {
        display: "flex", fontSize: Math.round(size * 0.022), fontWeight: 700,
        color: BG, backgroundColor: accent, padding: "10px 22px", borderRadius: 999,
        textTransform: "uppercase", letterSpacing: 1,
      },
    }, category),
  ]);
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

function bulletRow(text, accent, size) {
  return el("div", { style: { display: "flex", alignItems: "flex-start", marginBottom: 22 } }, [
    el("div", {
      style: {
        display: "flex", width: 16, height: 16, borderRadius: 999,
        backgroundColor: accent, marginTop: Math.round(size * 0.018), marginRight: 22, flexShrink: 0,
      },
    }, []),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.038), color: FG, lineHeight: 1.25 } }, text),
  ]);
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
  const children = words.map((w, i) => {
    const base = { display: "flex", fontWeight: 700, fontSize, lineHeight: 1.15, marginRight: gap, marginBottom: rowGap };
    if (!hi.has(i)) return el("div", { style: { ...base, color: FG } }, w);
    if (mode === "accent") return el("div", { style: { ...base, color: accent } }, w);
    return el("div", {
      style: { ...base, color: BG, backgroundColor: HIGHLIGHT_MARKER, paddingLeft: padX, paddingRight: padX, borderRadius: Math.round(fontSize * 0.09) },
    }, w);
  });
  return el("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "flex-start" } }, children);
}

// "Tuesday · 3 June 2026" eyebrow above the cover headline. Returns null when
// the story has no usable publish date (cover then renders headline-only).
function coverDateRow(story, accent, size) {
  const text = coverDateLine(story);
  if (!text) return null;
  return el("div", {
    style: {
      display: "flex", fontSize: Math.round(size * 0.026), fontWeight: 700,
      color: accent, letterSpacing: 1, marginBottom: Math.round(size * 0.035),
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

// Build the inner body for one slide kind. `size` is the square edge length.
// `portrait` (cover only) is { dataUri, name, credit } or null. `question`
// (engagement only) is the MCQ { question, options, correctIndex } or null.
function slideBody({ kind, story, accent, size, portrait, slideImage, whyItMatters, question, coverHook, coverHighlight, highlightMode = HIGHLIGHT_MODE }) {
  const headline = oneLine(story?.headline) || "Today's news quiz";

  // Body slides ("what"/"key points"/"why") prepend a smaller image of a story
  // entity above their text when one was resolved — real imagery, not bland text.
  const withImage = (content) => ((slideImage && slideImage.dataUri)
    ? el("div", { style: { display: "flex", flexDirection: "column" } }, [
      imageHero({ image: slideImage, size, widthRatio: 0.62, heightRatio: 0.42, marginRatio: 0.03 }),
      content,
    ])
    : content);

  if (kind === "cover") {
    // Prefer the concrete hook generated upstream for the cover; fall back to the
    // raw headline when none was supplied. The highlight belongs to the HOOK, so
    // it is dropped on the headline fallback — both so the fallback isn't randomly
    // emphasised and so its bytes match the shared "nohook" cache/storage variant.
    const hookText = oneLine(coverHook);
    const cover = hookText || headline;
    const children = [];
    if (portrait && portrait.dataUri) children.push(imageHero({ image: portrait, size }));
    const dateRow = coverDateRow(story, accent, size);
    if (dateRow) children.push(dateRow);
    children.push(coverHeadline(cover, size, { highlight: hookText ? coverHighlight : "", mode: highlightMode, accent }));
    // Single child and no date → keep the original bare-headline node (matches
    // the pre-feature layout exactly for stories with no publish date).
    if (children.length === 1) return children[0];
    return el("div", { style: { display: "flex", flexDirection: "column" } }, children);
  }

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
    const points = keyPoints(story).slice(0, 3);
    const rows = points.length
      ? points.map((p) => bulletRow(p, accent, size))
      : [el("div", { style: { display: "flex", fontSize: Math.round(size * 0.04), color: FG, lineHeight: 1.3 } }, firstSentences(story?.summary, 2) || headline)];
    return withImage(el("div", { style: { display: "flex", flexDirection: "column" } }, [
      eyebrow("Key points", accent, size),
      ...rows,
    ]));
  }

  if (kind === "why") {
    // The historical "Why it matters" points (LLM-generated, passed in via
    // whyItMatters) on their own slide. This slide is only included in the set
    // when points exist (see carouselSlidesFor); the summary fallback guards the
    // case where the slide is requested explicitly without points.
    const why = (Array.isArray(whyItMatters) ? whyItMatters.filter(Boolean) : []).slice(0, 3);
    const rows = why.length
      ? why.map((p) => bulletRow(p, accent, size))
      : [el("div", { style: { display: "flex", fontSize: Math.round(size * 0.04), color: FG, lineHeight: 1.3 } }, firstSentences(story?.summary, 2) || headline)];
    return withImage(el("div", { style: { display: "flex", flexDirection: "column" } }, [
      eyebrow("Why it matters", accent, size),
      ...rows,
    ]));
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

function slideTree({ kind, story, accent, category, index, total, size, height, portrait, slideImage, whyItMatters, question, coverHook, coverHighlight, highlightMode }) {
  const padX = Math.round(size * PAD_X_RATIO);
  const padY = Math.round(size * PAD_Y_RATIO);
  const hint = kind === "cover" ? "Swipe to read →"
    : (kind === "engagement" ? "Tap to comment →" : "");
  return el("div", {
    style: {
      width: size, height, display: "flex", flexDirection: "column",
      justifyContent: "space-between", backgroundColor: BG,
      padding: `${padY}px ${padX}px`, fontFamily: "Lato",
    },
  }, [
    slideHeader({ category, accent, size }),
    el("div", { style: { display: "flex", flexGrow: 1, flexDirection: "column", justifyContent: "center" } }, [
      slideBody({ kind, story, accent, size, portrait, slideImage, whyItMatters, question, coverHook, coverHighlight, highlightMode }),
    ]),
    slideFooter({ accent, size, index, total, hint }),
  ]);
}

// Render the full Instagram carousel as ordered JPEG slides. Defaults to JPEG
// because the Instagram Graph API rejects non-JPEG media containers.
//
// When `withPortrait` is on, the cover slide gains a large licensed image of the
// lead entity (person, else org/place) with a credit. Resolving the image is
// best-effort and happens once up front; any failure leaves the cover text-only.
// `fetchImpl` is injectable for tests.
export async function renderCarouselSlides(story, { format = "jpeg", slides, withPortrait = false, whyItMatters = [], question = null, coverHook = null, coverHighlight = null, highlightMode = HIGHLIGHT_MODE, fetchImpl } = {}) {
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
    const coverSpec = slideList.includes("cover") ? leadCoverImage(story) : null;
    const bodyKinds = ["what", "keypoints", "why"].filter((k) => slideList.includes(k));
    const bodySpecs = entityImages(story)
      .filter((s) => s.name !== coverSpec?.name)
      .slice(0, bodyKinds.length);
    const [coverImg, ...bodyImgs] = await Promise.all([
      resolveImage(coverSpec, fetchImpl),
      ...bodySpecs.map((s) => resolveImage(s, fetchImpl)),
    ]);
    portrait = coverImg;
    bodyImgs.forEach((img, i) => { if (img) bodyImageByKind[bodyKinds[i]] = img; });
  }

  const out = [];
  for (let index = 0; index < slideList.length; index++) {
    const kind = slideList[index];
    const svg = await satori(
      slideTree({ kind, story, accent, category, index, total, size, height, portrait: kind === "cover" ? portrait : null, slideImage: bodyImageByKind[kind] || null, whyItMatters, question: kind === "engagement" ? question : null, coverHook: kind === "cover" ? coverHook : null, coverHighlight: kind === "cover" ? coverHighlight : null, highlightMode }),
      { width, height, fonts }
    );
    const { buffer, contentType } = rasterize(svg, { width, format });
    out.push({ buffer, contentType, width, height, slideType: kind, index });
  }
  return out;
}

export { SHAPES, CAROUSEL_SLIDES, coverDateLine };
