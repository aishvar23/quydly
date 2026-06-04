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

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");

// Per-category accent colour (matches config/categories.js ids).
const ACCENT = {
  world: "#2563EB",
  tech: "#7C3AED",
  finance: "#059669",
  culture: "#DB2777",
  science: "#D97706",
};
const DEFAULT_ACCENT = "#1D4ED8";
const BG = "#0B0F1A";
const FG = "#FFFFFF";
const MUTED = "#9CA3AF";

const SHAPES = {
  landscape: { width: 1600, height: 900 },
  square: { width: 1080, height: 1080 },
};

// The four-slide carousel (tracker L4): headline / what happened / why it
// matters / CTA. Order here is the order they are published in.
const CAROUSEL_SLIDES = ["cover", "what", "why", "cta"];
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

// Surface the portrait of the story's LEAD person only. primary_entities_enriched
// is ordered by primacy, so the first `type:"person"` entry is the lead subject.
// We consider ONLY that lead person — we never fall through to a later person, as
// that would put the wrong face on the cover. Returns null when there is no person
// entity, or the lead person has no usable licensed HTTPS portrait (text-only cover).
function leadPersonPortrait(story) {
  const ents = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  const lead = ents.find((e) => e && e.type === "person");
  if (!lead) return null;
  // Cover inset is small (~0.3× the card edge), so prefer the thumbnail over
  // the full-resolution override image — a large press photo would otherwise
  // download only to be rejected by PORTRAIT_MAX_BYTES.
  const url = lead.portrait_thumbnail_url || lead.portrait_image_url || lead.wikipedia_thumbnail_url;
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
  return { url, name: oneLine(lead.name), credit: portraitCredit(lead) };
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
  const accent = ACCENT[story?.category_id] || DEFAULT_ACCENT;
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

// The cover headline block, sized to its length.
function coverHeadline(headline, size) {
  return el("div", {
    style: {
      display: "flex", color: FG, fontWeight: 700,
      fontSize: Math.round(size * (headline.length > HEADLINE_COMPACT_CHARS ? 0.058 : 0.072)), lineHeight: 1.15,
    },
  }, headline);
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

// Circular portrait + name + credit, shown above the headline on the cover when
// the story is about a person and a licensed photo resolved.
function coverPortraitBlock({ portrait, accent, size }) {
  const photo = Math.round(size * 0.3);
  const meta = [];
  if (portrait.name) {
    meta.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.034), fontWeight: 700, color: FG } }, portrait.name));
  }
  if (portrait.credit) {
    meta.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.02), color: MUTED, marginTop: 6 } }, `Photo: ${portrait.credit}`));
  }
  return el("div", { style: { display: "flex", alignItems: "center", marginBottom: Math.round(size * 0.05) } }, [
    el("img", {
      src: portrait.dataUri, width: photo, height: photo,
      style: {
        width: photo, height: photo, borderRadius: 999, objectFit: "cover",
        marginRight: Math.round(size * 0.045), border: `${Math.round(size * 0.006)}px solid ${accent}`,
      },
    }),
    el("div", { style: { display: "flex", flexDirection: "column" } }, meta),
  ]);
}

// Build the inner body for one slide kind. `size` is the square edge length.
// `portrait` (cover only) is { dataUri, name, credit } or null.
function slideBody({ kind, story, accent, size, portrait }) {
  const headline = oneLine(story?.headline) || "Today's news quiz";

  if (kind === "cover") {
    const dateRow = coverDateRow(story, accent, size);
    const children = [];
    if (dateRow) children.push(dateRow);
    if (portrait && portrait.dataUri) children.push(coverPortraitBlock({ portrait, accent, size }));
    children.push(coverHeadline(headline, size));
    // Single child and no date → keep the original bare-headline node (matches
    // the pre-feature layout exactly for stories with no publish date).
    if (children.length === 1) return children[0];
    return el("div", { style: { display: "flex", flexDirection: "column" } }, children);
  }

  if (kind === "what") {
    const summary = firstSentences(story?.summary, 3) || headline;
    return el("div", { style: { display: "flex", flexDirection: "column" } }, [
      eyebrow("What happened", accent, size),
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.044), color: FG, lineHeight: 1.3 } }, summary),
    ]);
  }

  if (kind === "why") {
    const points = keyPoints(story).slice(0, 3);
    const rows = points.length
      ? points.map((p) => bulletRow(p, accent, size))
      : [el("div", { style: { display: "flex", fontSize: Math.round(size * 0.04), color: FG, lineHeight: 1.3 } }, firstSentences(story?.summary, 2) || headline)];
    return el("div", { style: { display: "flex", flexDirection: "column" } }, [
      eyebrow("Why it matters", accent, size),
      ...rows,
    ]);
  }

  // cta
  return el("div", { style: { display: "flex", flexDirection: "column" } }, [
    el("div", {
      style: { display: "flex", color: FG, fontWeight: 700, fontSize: Math.round(size * 0.07), lineHeight: 1.15, marginBottom: 28 },
    }, "Take today's news quiz"),
    el("div", {
      style: { display: "flex", fontSize: Math.round(size * 0.04), color: MUTED, lineHeight: 1.3 },
    }, "5 questions · about 3 minutes · resets daily"),
  ]);
}

function slideTree({ kind, story, accent, category, index, total, size, portrait }) {
  const padX = Math.round(size * PAD_X_RATIO);
  const padY = Math.round(size * PAD_Y_RATIO);
  const hint = kind === "cta" ? "quydly.com" : (kind === "cover" ? "Swipe to read →" : "");
  return el("div", {
    style: {
      width: size, height: size, display: "flex", flexDirection: "column",
      justifyContent: "space-between", backgroundColor: BG,
      padding: `${padY}px ${padX}px`, fontFamily: "Lato",
    },
  }, [
    slideHeader({ category, accent, size }),
    el("div", { style: { display: "flex", flexGrow: 1, flexDirection: "column", justifyContent: "center" } }, [
      slideBody({ kind, story, accent, size, portrait }),
    ]),
    slideFooter({ accent, size, index, total, hint }),
  ]);
}

// Render the full Instagram carousel as ordered JPEG slides. Defaults to JPEG
// because the Instagram Graph API rejects non-JPEG media containers.
//
// When `withPortrait` is on and the story is about a person, the cover slide
// gains a circular portrait inset (licensed photo + credit). Resolving the
// portrait is best-effort and happens once up front; any failure leaves the
// cover text-only. `fetchImpl` is injectable for tests.
export async function renderCarouselSlides(story, { format = "jpeg", slides = CAROUSEL_SLIDES, withPortrait = false, fetchImpl } = {}) {
  const { width: size } = SHAPES.square;
  const accent = ACCENT[story?.category_id] || DEFAULT_ACCENT;
  const category = oneLine(story?.category_id || "news");
  const fonts = await loadFonts();
  const total = slides.length;

  let portrait = null;
  if (withPortrait && slides.includes("cover")) {
    const lead = leadPersonPortrait(story);
    if (lead) {
      const dataUri = await fetchImageDataUri(lead.url, fetchImpl ? { fetchImpl } : {});
      if (dataUri) portrait = { dataUri, name: lead.name, credit: lead.credit };
    }
  }

  const out = [];
  for (let index = 0; index < slides.length; index++) {
    const kind = slides[index];
    const svg = await satori(
      slideTree({ kind, story, accent, category, index, total, size, portrait: kind === "cover" ? portrait : null }),
      { width: size, height: size, fonts }
    );
    const { buffer, contentType } = rasterize(svg, { width: size, format });
    out.push({ buffer, contentType, width: size, height: size, slideType: kind, index });
  }
  return out;
}

export { SHAPES, CAROUSEL_SLIDES, coverDateLine };
