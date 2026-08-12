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

// Pick the slide list for a story. Optional slides are dropped when they would be
// empty, so a story with none renders the original 4-slide set
// (cover/what/keypoints/cta):
//   • "why"       — only when historical "why it matters" points were supplied;
//   • "numbers"   — a "By the numbers" data slide (Anton hero numerals built from
//                   story.structured_numbers), inserted right after "what" so the
//                   hard data pays off the cover hook early. Only when the story
//                   carries usable sourced figures (hasNumbers);
//   • "engagement"— only when a valid MCQ was supplied.
function carouselSlidesFor(whyItMatters, question, hasNumbers = false) {
  const why = Array.isArray(whyItMatters) ? whyItMatters.filter(Boolean) : [];
  let list = why.length ? CAROUSEL_SLIDES : CAROUSEL_SLIDES_NO_WHY;
  if (!isEngagementQuestion(question)) list = list.filter((k) => k !== "engagement");
  if (hasNumbers) {
    const at = list.indexOf("what");
    list = at >= 0 ? [...list.slice(0, at + 1), "numbers", ...list.slice(at + 1)] : ["numbers", ...list];
  }
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

// ── Gold-standard news carousel THEME ────────────────────────────────────────
//
// Single source of truth for the "Wealth-class" news carousel look (benchmarked
// on @wealth): the display + body faces, the bottom-weighted legibility scrim,
// the type scale (as fractions of the 1080px canvas width — Satori scales by
// width), the padding, and the default accent. The news slide renderers
// (coverTree / contentSlideTree / the numbers slide) read from THIS object
// instead of scattered magic numbers, so the whole set reads as ONE designed
// template and the template can be tuned in one place. The FOOTBALL variant
// keeps its own constants (FB_* / fullBleedSlideTree) — do not fold it in here.
const THEME = {
  bg: BG,
  fg: FG,
  muted: MUTED,
  display: "Anton", // condensed heavy face — cover hook, section heads, hero numerals
  body: "Lato", // readable face — ledes, bullets, options, captions
  padXRatio: PAD_X_RATIO,
  padYRatio: PAD_Y_RATIO,
  accentFallback: "#22D3EE", // neutral cyan when a story has no category accent
  // Bottom-weighted scrim shared by every news body slide: light up top so the
  // photo reads, ramping to near-opaque BG where the text sits. Satori cannot
  // sample the image, so this ramp is tuned to hold legible over the BRIGHTEST
  // plausible photo — it reaches ~0.75 by 46% down, because the tallest body
  // (the numbers slide: hero numeral + label + rows) starts that high and used
  // to wash out over bright imagery when the ramp only reached ~0.30 there. ONE
  // ramp for the whole set so the carousel reads as one designed template.
  bodyScrim:
    "linear-gradient(180deg, rgba(11,15,26,0.20) 0%, rgba(11,15,26,0.45) 28%, rgba(11,15,26,0.75) 46%, rgba(11,15,26,0.92) 64%, rgba(11,15,26,0.98) 100%)",
  // Dark halo behind text so a bright element poking through the scrim can't
  // erase a glyph — belt-and-braces with the scrim. `textShadow` for body text;
  // `textShadowHero` (wider, heavier) for the big Anton hero numeral / hooks,
  // which cover more area and so sit over more image variance.
  textShadow: "0 2px 8px rgba(11,15,26,0.60)",
  textShadowHero: "0 3px 14px rgba(11,15,26,0.72)",
  // Type scale as fractions of the 1080px width.
  scale: {
    coverHook: 0.072, coverHookLong: 0.058,
    statHero: 0.2, section: 0.05, eyebrow: 0.03,
    lede: 0.052, body: 0.04, stat: 0.052, statLabel: 0.03, caption: 0.024,
  },
};

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

// Common English function words to ignore when scoring key-point relevance, so
// overlap is driven by content words (entities, topic terms), not "the"/"and".
const KP_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had", "was", "were",
  "are", "will", "would", "its", "into", "over", "after", "amid", "than", "then", "who", "which",
  "but", "not", "you", "your", "their", "they", "them", "his", "her", "our", "out", "per", "via",
]);

// Order a story's key points by on-topic relevance to the HEADLINE + primary
// entities (a light narrative fix — the full coherence gate is a later phase), so
// the most on-topic point leads the "Key points" slide and off-topic tangents
// sink. Scored by shared content-word count; ties keep the original order (stable).
function orderedKeyPoints(story) {
  const pts = keyPoints(story);
  if (pts.length <= 1) return pts;
  const ents = (Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [])
    .map((e) => e && e.name).filter(Boolean).join(" ");
  const words = (s) => (String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !KP_STOPWORDS.has(w));
  const topic = new Set(words(`${oneLine(story?.headline)} ${ents}`));
  const scored = pts.map((p, i) => {
    let s = 0;
    for (const w of new Set(words(p))) if (topic.has(w)) s++;
    return { p, i, s };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.p);
}

// Abbreviations whose trailing period is NOT a sentence boundary. Without this
// the body truncated mid-sentence on IG ("…died at St.", "Warner Bros.") because
// the abbreviation's period was read as the end of the first sentence.
const SENTENCE_ABBREV = new Set([
  "mr", "mrs", "ms", "dr", "prof", "rev", "sr", "jr", "st", "mt", "ft",
  "bros", "inc", "ltd", "co", "corp", "plc", "llc", "gov", "dept", "univ",
  "vs", "etc", "al", "no", "sen", "rep", "gen", "lt", "col", "sgt", "capt",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "u.s", "u.k", "u.n", "e.g", "i.e", "a.m", "p.m",
]);

// First N sentences of a blob, whitespace-normalised. Abbreviation-aware: a
// period inside a known abbreviation ("St.", "Warner Bros.", "Dr."), after a
// single capital initial ("J. R. R."), or inside a decimal ("$1.5") is NOT a
// sentence end, so the body never truncates mid-sentence.
function firstSentences(text, n = 2) {
  const clean = oneLine(text);
  if (!clean) return "";
  const sentences = [];
  let start = 0;
  for (let i = 0; i < clean.length && sentences.length < n; i++) {
    if (!".!?".includes(clean[i])) continue;
    // Absorb a run of terminators ("?!", "…", "...") so the whole run stays together.
    let end = i;
    while (end + 1 < clean.length && ".!?".includes(clean[end + 1])) end++;
    const next = clean[end + 1];
    // A boundary requires end-of-string or whitespace after the terminator(s);
    // a period glued to the next char is a decimal/URL/etc., not a break.
    if (next !== undefined && !/\s/.test(next)) { i = end; continue; }
    // Reject abbreviations and single-letter initials by inspecting the word the
    // period attaches to (only matters for "."; "!"/"?" never abbreviate).
    if (clean[i] === ".") {
      const before = clean.slice(start, i);
      const tok = (before.match(/(\S+)$/) || ["", ""])[1].toLowerCase().replace(/[^a-z0-9.]/g, "").replace(/\.+$/, "");
      if (SENTENCE_ABBREV.has(tok) || /^[a-z]$/.test(tok)) { i = end; continue; }
    }
    sentences.push(clean.slice(start, end + 1).trim());
    start = end + 1;
    i = end;
  }
  if (sentences.length < n && start < clean.length) {
    const tail = clean.slice(start).trim();
    if (tail) sentences.push(tail);
  }
  return sentences.slice(0, n).join(" ").trim();
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
//   photoBodyKinds    — the body kinds ELIGIBLE for a current-story entity photo
//                       (bodyKinds minus "engagement"); bodySpecs align to these;
//   bodySpecs         — the entity images for the body slides, with the reserved
//                       cover entity held back so it never appears on both.
//
// The engagement slide is excluded from entity photos: its MCQ is drawn from a
// DIFFERENT (previous) story, so a current-story entity photo would visually
// assert an entity unrelated to the question. It keeps the neutral gradient floor
// (it is not sized an illustration either — see plannedIllustrationCount).
function planEntityImagery(story, contentKinds) {
  const hasCover = contentKinds.includes("cover");
  const coverSpec = hasCover ? leadPersonImage(story) : null;
  const coverFallbackSpec = (hasCover && !coverSpec) ? leadOrgPlaceImage(story) : null;
  const reservedName = coverSpec?.name || coverFallbackSpec?.name;
  const bodyKinds = contentKinds.filter((k) => k !== "cover");
  const photoBodyKinds = bodyKinds.filter((k) => k !== "engagement");
  const bodySpecs = entityImages(story).filter((s) => s.name !== reservedName).slice(0, photoBodyKinds.length);
  return { hasCover, coverSpec, coverFallbackSpec, bodyKinds, photoBodyKinds, bodySpecs };
}

// Canonical, ORDER-PRESERVING list of the news slide kinds that carry a full-bleed
// background image (photo → generated illustration → gradient floor). Used to
// derive both the generator's illustration sizing (plannedIllustrationCount) and
// the renderer's imagery allocation from a slide list, so the two can't drift.
const IMAGE_SLIDE_KINDS = ["cover", "what", "numbers", "keypoints", "why", "engagement", "cta"];
const imageSlideKinds = (slideList) => IMAGE_SLIDE_KINDS.filter((k) => slideList.includes(k));

// Whether a story has usable sourced figures for the "By the numbers" slide.
function storyHasNumbers(story) {
  return !!selectStoryNumbers(story);
}

// The ORDERED content-slide kinds that need an editorial illustration — every
// DETERMINISTIC content slide (cover / what / [numbers] / key points / [why]) that
// won't be backed by a usable PHOTO under planEntityImagery, in slide order. The
// cover is photo-backed ONLY by a lead PERSON image; org logos / place flags never
// pre-empt an illustration on the cover. engagement/cta are intentionally excluded
// (they sit at the tail of the slide list and fall back to the gradient floor when
// no illustration is routed). The generator generates exactly these, IN ORDER, and
// renderCarouselSlides routes them positionally to the photo-less slots — so the
// KINDS (not just the count) must be passed to the scene writer, otherwise a
// cover-hook scene lands on a body slide whenever the cover is photo-backed.
export function plannedIllustrationKinds(story, { whyItMatters = [] } = {}) {
  const hasWhy = Array.isArray(whyItMatters) && whyItMatters.filter(Boolean).length > 0;
  const contentKinds = ["cover", "what", ...(storyHasNumbers(story) ? ["numbers"] : []), "keypoints", ...(hasWhy ? ["why"] : [])];
  const { coverSpec, photoBodyKinds, bodySpecs } = planEntityImagery(story, contentKinds);
  // The body kinds that get a photo are the first bodySpecs.length of the
  // photo-eligible body kinds (planEntityImagery assigns bodySpecs by position).
  const photoed = new Set(photoBodyKinds.slice(0, bodySpecs.length));
  if (coverSpec) photoed.add("cover");
  return contentKinds.filter((k) => !photoed.has(k));
}

// How many illustrations the carousel needs — the length of the gap-kind list.
export function plannedIllustrationCount(story, opts = {}) {
  return plannedIllustrationKinds(story, opts).length;
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
      textShadow: THEME.textShadow,
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
    el("div", { style: { display: "flex", fontSize: fontPx, color: FG, lineHeight: BULLET_LINE_H, textShadow: THEME.textShadow } }, text),
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
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.036), color: FG, lineHeight: 1.25, textShadow: THEME.textShadow } }, text),
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
  // The bold condensed display face (Anton) for the cover hook — the @wealth
  // scroll-stopping title look. Tight leading; sourced from THEME so the whole
  // set stays consistent.
  const fontSize = Math.round(size * (headline.length > HEADLINE_COMPACT_CHARS ? THEME.scale.coverHookLong : THEME.scale.coverHook));
  const words = headline.split(/\s+/).filter(Boolean);
  const hi = highlightWordIndices(words, highlight);

  if (!hi.size) {
    return el("div", { style: { display: "flex", fontFamily: THEME.display, color: FG, fontWeight: 700, fontSize, lineHeight: 1.06, textShadow: THEME.textShadowHero } }, headline);
  }

  const gap = Math.round(fontSize * 0.26);     // inter-word space
  const rowGap = Math.round(fontSize * 0.16);  // line spacing between wrapped rows
  const padX = Math.round(fontSize * 0.14);
  const base = { display: "flex", fontFamily: THEME.display, fontWeight: 700, fontSize, lineHeight: 1.06, marginRight: gap, marginBottom: rowGap, textShadow: THEME.textShadowHero };

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
        : el("div", { style: { ...base, color: BG, textShadow: "none", backgroundColor: HIGHLIGHT_MARKER, paddingLeft: padX, paddingRight: padX, borderRadius: Math.round(fontSize * 0.09) } }, phrase));
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
      textShadow: THEME.textShadow,
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

// Legibility scrim for the text-heavy news body slides — the SINGLE, luminance-
// aware ramp from THEME.bodyScrim: near-transparent at the top so the image
// reads, ramping to almost-opaque BG in the lower half where the eyebrow + text
// sit. One ramp for the whole news set (what / numbers / key points / why /
// engagement / cta) so the carousel reads as ONE designed template.
function contentScrim(size, height) {
  return el("div", {
    style: {
      position: "absolute", top: 0, left: 0, display: "flex", width: size, height,
      backgroundImage: THEME.bodyScrim,
    },
  }, []);
}

// ── "By the numbers" data slide ──────────────────────────────────────────────
//
// Cap a stat LABEL (the structured-number `role`) so a long role string
// ("gain from previous close to 52-week high") stays on one/two lines.
function statLabel(role) {
  const s = oneLine(role);
  return s.length > 42 ? `${s.slice(0, 41).trimEnd()}…` : s;
}

// Select the figures for the "By the numbers" slide from story.structured_numbers
// (shape: { money[], percentages[], counts[], casualties[], magnitudes[] }, each
// item { role, value, display }). Returns { hero, rows } or null when there is
// nothing usable. The HERO is the punchiest percentage (largest |value|) — the
// aha number that pays off the cover — else the first money/count figure; the
// rows are the next few figures (percentages first, then money) as supporting
// stats. Every value is a SOURCED display string — we never compute or invent a
// figure here (factual-safety: render only what the pipeline extracted).
function selectStoryNumbers(story) {
  const sn = story?.structured_numbers;
  if (!sn || typeof sn !== "object") return null;
  const clean = (arr) => (Array.isArray(arr) ? arr : []).filter((n) => n && oneLine(n.display));
  const pct = clean(sn.percentages);
  const money = clean(sn.money);
  const counts = [...clean(sn.counts), ...clean(sn.magnitudes), ...clean(sn.casualties)];
  const byMag = (a, b) => Math.abs(Number(b.value) || 0) - Math.abs(Number(a.value) || 0);
  const pctSorted = [...pct].sort(byMag);
  // Hero: the biggest percentage move (most scroll-stopping); fall back to the
  // first money figure, then the first count. Everything else becomes a row.
  const pool = [...pctSorted, ...money, ...counts];
  if (!pool.length) return null;
  const hero = pool[0];
  const rows = pool.slice(1, 4).map((n) => ({ display: oneLine(n.display), label: statLabel(n.role) }));
  return { hero: { display: oneLine(hero.display), label: statLabel(hero.role) }, rows };
}

// One supporting stat row on the numbers slide: an accent tick + the value in the
// condensed display face (tabular, per the visual system) + the label.
function statRow(value, label, accent, size) {
  return el("div", { style: { display: "flex", alignItems: "center", marginBottom: Math.round(size * 0.024) } }, [
    el("div", { style: { display: "flex", width: Math.round(size * 0.012), height: Math.round(size * 0.052), backgroundColor: accent, marginRight: Math.round(size * 0.022), borderRadius: 2, flexShrink: 0 } }, []),
    el("div", { style: { display: "flex", fontFamily: THEME.display, fontSize: Math.round(size * THEME.scale.stat), color: FG, width: Math.round(size * 0.28), flexShrink: 0, textShadow: THEME.textShadow } }, value),
    el("div", { style: { display: "flex", fontSize: Math.round(size * THEME.scale.statLabel), color: "rgba(255,255,255,0.82)", lineHeight: 1.15, textShadow: THEME.textShadow } }, label),
  ]);
}

// ── "By the numbers" auto-fit ────────────────────────────────────────────────
//
// The hero display is NOT always a short "226%": the enrichment schema permits
// multi-word values ("$8 billion", "at least 17 dead"), which wrap to two or
// three lines at the top hero size and, stacked with the label + supporting rows
// + source, overflow the FIXED slide height and clip the lower rows / footer
// (Satori has no overflow). So — like the bullet slides (fitBulletSlide) — fit
// the whole stack to a vertical budget: shrink the hero first (keep every
// supporting figure), and only as a last resort drop trailing rows.
const NUMBERS_HERO_LEVELS = [0.2, 0.165, 0.135, 0.11]; // fractions of width, densest → smallest
const ANTON_AVG_CHAR_EM = 0.48; // Anton is condensed, so a tighter advance than Lato's 0.52

function fitNumbersStack(picked, size, budgetPx) {
  const colW = size * (1 - 2 * PAD_X_RATIO);
  // Conservative per-part height estimates (err toward NOT clipping): a label or
  // a row label may wrap to two lines, so the row estimate carries slack.
  const eyebrowH = Math.round(size * 0.03 * 1.2) + 24;
  const labelH = picked.hero.label ? Math.round(size * THEME.scale.body * 1.3) + Math.round(size * 0.042) : 0;
  const sourceH = Math.round(size * 0.02 * 1.2) + Math.round(size * 0.03);
  const rowH = Math.round(size * THEME.scale.stat) + Math.round(size * 0.024) + Math.round(size * 0.03);
  const heroLines = (heroPx) => {
    const cpl = Math.max(1, colW / (heroPx * ANTON_AVG_CHAR_EM));
    return Math.max(1, Math.ceil(picked.hero.display.length / cpl));
  };
  const fixed = eyebrowH + labelH + sourceH;
  // Prefer keeping ALL rows: step the hero size down until the full stack fits.
  for (const level of NUMBERS_HERO_LEVELS) {
    const heroPx = Math.round(size * level);
    if (fixed + heroLines(heroPx) * heroPx + picked.rows.length * rowH <= budgetPx) {
      return { heroPx, rows: picked.rows };
    }
  }
  // Even the smallest hero with every row overflows → smallest hero, then drop
  // trailing rows until it fits (a pathological long hero can end with 0 rows).
  const heroPx = Math.round(size * NUMBERS_HERO_LEVELS[NUMBERS_HERO_LEVELS.length - 1]);
  const heroH = heroLines(heroPx) * heroPx;
  let rows = picked.rows.length;
  while (rows > 0 && fixed + heroH + rows * rowH > budgetPx) rows -= 1;
  return { heroPx, rows: picked.rows.slice(0, rows) };
}

// The "By the numbers" body: a BIG Anton hero numeral + its label, then up to
// three supporting stat rows. Mirrors the football stat-insights primitive (a
// hero line + grounded rows) but for news structured numbers. The hero size and
// row count are fitted to the slide height so a long multi-word value can't push
// the stack off the card.
function numbersBody({ story, accent, size, height, source }) {
  const picked = selectStoryNumbers(story);
  const children = [eyebrow("By the numbers", accent, size)];
  if (picked) {
    // Budget = slide height minus the top/bottom padding and the header+footer
    // chrome (which the body must never grow into).
    const budget = height - 2 * Math.round(size * THEME.padYRatio) - Math.round(size * 0.22);
    const fit = fitNumbersStack(picked, size, budget);
    children.push(el("div", { style: { display: "flex", fontFamily: THEME.display, fontSize: fit.heroPx, color: FG, lineHeight: 1, letterSpacing: 1, textShadow: THEME.textShadowHero } }, picked.hero.display));
    if (picked.hero.label) {
      children.push(el("div", { style: { display: "flex", fontSize: Math.round(size * THEME.scale.body), color: "rgba(255,255,255,0.86)", lineHeight: 1.2, marginBottom: Math.round(size * 0.036), marginTop: Math.round(size * 0.006), textShadow: THEME.textShadow } }, picked.hero.label));
    }
    fit.rows.forEach((r) => children.push(statRow(r.display, r.label, accent, size)));
  } else {
    children.push(el("div", { style: { display: "flex", fontFamily: THEME.display, fontSize: Math.round(size * 0.06), color: FG, lineHeight: 1.08, textShadow: THEME.textShadowHero } }, "The numbers behind the story."));
  }
  if (source) {
    children.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.02), color: MUTED, marginTop: Math.round(size * 0.03) } }, `Source: ${source}`));
  }
  return el("div", { style: { display: "flex", flexDirection: "column" } }, children);
}

// The engagement MCQ body (full-bleed variant): the question + 4 lettered options
// over the slide image. The correct answer is NEVER shown here — it is revealed in
// a comment 12h later.
function engagementBody({ accent, size, question }) {
  const q = oneLine(question?.question) || "Today's quiz question";
  const options = (Array.isArray(question?.options) ? question.options : []).slice(0, 4);
  const letters = ["A", "B", "C", "D"];
  return el("div", { style: { display: "flex", flexDirection: "column" } }, [
    eyebrow("Knowledge test", accent, size),
    el("div", { style: { display: "flex", color: FG, fontWeight: 700, fontSize: Math.round(size * 0.046), lineHeight: 1.25, marginBottom: Math.round(size * 0.04), textShadow: THEME.textShadow } }, q),
    ...options.map((opt, i) => optionRow(letters[i], oneLine(opt), accent, size)),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.03), color: "rgba(255,255,255,0.82)", lineHeight: 1.3, marginTop: Math.round(size * 0.024), textShadow: THEME.textShadow } }, "Reply with your pick in the comments"),
  ]);
}

// The CTA body (full-bleed variant): a Save-first ask (the retention signal),
// then the follow handle. Anton for the hook line, matching the news set's look.
function ctaBody({ accent, size }) {
  return el("div", { style: { display: "flex", flexDirection: "column" } }, [
    el("div", { style: { display: "flex", fontFamily: THEME.display, fontSize: Math.round(size * 0.07), color: FG, letterSpacing: 1, lineHeight: 1.02, marginBottom: Math.round(size * 0.018), textShadow: THEME.textShadowHero } }, "SAVE THIS FOR LATER"),
    el("div", { style: { display: "flex", fontSize: Math.round(size * 0.036), color: "rgba(255,255,255,0.86)", lineHeight: 1.35, marginBottom: Math.round(size * 0.036), textShadow: THEME.textShadow } }, "Tap save, then follow for tomorrow's brief — the day's biggest stories, decoded."),
    el("div", { style: { display: "flex", color: accent, fontWeight: 700, fontSize: Math.round(size * 0.052), textShadow: THEME.textShadow } }, QUYDLY_IG_HANDLE()),
  ]);
}

// Deterministic open-loop teaser for the footer of each non-final NEWS slide (the
// @thevikasroy retention pattern). Templated from the slide list — never an LLM
// line that could overclaim.
function newsTeaser(nextKind) {
  switch (nextKind) {
    case "what": return "Next: what happened →";
    case "numbers": return "Next: the numbers →";
    case "keypoints": return "Next: the key facts →";
    case "why": return "Next: why it matters →";
    case "engagement": return "Next: test yourself →";
    default: return "";
  }
}

// ── Image-led body slides (what / numbers / key points / why / engagement / cta) ──

// Fraction of the slide height reserved for the text block at the bottom — the
// heavily-scrimmed zone where the eyebrow + bullets stay legible over the image.
const CONTENT_TEXT_ZONE = 0.46;

// The bottom text block for an image-led body slide: the eyebrow + its content
// (a single lede for "what"; up to three auto-fit bullets for "key points" /
// "why"), then a caption identifying the licensed image — the entity NAME (e.g.
// "Brownstone Productions") plus a "Photo: …" credit. Attribution is mandatory
// (never show a licensed photo without crediting it), and the name gives the
// otherwise-unlabelled logo/photo context.
function contentBody({ kind, story, accent, size, height, whyItMatters, question, source, imageName, credit }) {
  const headline = oneLine(story?.headline) || "Today's news quiz";
  // The image-backed utility slides (numbers / engagement / cta) carry no photo
  // caption (their imagery is a generated illustration / generic stock, not a
  // licensed entity photo) and have their own layout.
  if (kind === "numbers") return numbersBody({ story, accent, size, height, source });
  if (kind === "engagement") return engagementBody({ accent, size, question });
  if (kind === "cta") return ctaBody({ accent, size });

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
      el("div", { style: { display: "flex", fontSize: Math.round(size * 0.052), color: FG, lineHeight: 1.4, textShadow: THEME.textShadow } }, summary),
    ]);
  }

  // "Key points" (today's key_points, ordered on-topic by relevance to the
  // headline entity) and "Why it matters" (historical points passed in via
  // whyItMatters) share one bullet layout, with a summary fallback.
  const label = kind === "why" ? "Why it matters" : "Key points";
  const points = (kind === "why"
    ? (Array.isArray(whyItMatters) ? whyItMatters.filter(Boolean) : [])
    : orderedKeyPoints(story)).slice(0, 3);
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

// The UNIFIED news body scaffold: every non-cover news slide (what / numbers /
// key points / why / engagement / cta) renders through this ONE full-bleed
// treatment — a photo covers the frame (logo contained on the gradient floor,
// gradient alone when there's no image) under the single THEME luminance-aware
// scrim, with the brand chrome pinned top, the body anchored low in the scrimmed
// zone, and an open-loop teaser + page indicator in the footer. The football
// carousel keeps its own scaffold (fullBleedSlideTree); this is the news seed of
// the gold-standard template.
function contentSlideTree({ kind, story, accent, category, index, total, size, height, slideImage, whyItMatters, question, source, nextKind }) {
  const padX = Math.round(size * THEME.padXRatio);
  const padY = Math.round(size * THEME.padYRatio);
  // Illustrations carry no name/credit (not a licensed photo); entity photos do.
  const credit = oneLine(slideImage?.credit);
  const imageName = oneLine(slideImage?.name);
  // Open-loop teaser threads the narrative arc; engagement keeps its comment nudge.
  const hint = kind === "engagement" ? "Tap to comment →" : newsTeaser(nextKind);
  const foreground = el("div", {
    style: {
      position: "relative", width: size, height, display: "flex", flexDirection: "column",
      justifyContent: "space-between", padding: `${padY}px ${padX}px`, fontFamily: THEME.body,
    },
  }, [
    slideHeader({ category, accent, size }),
    el("div", { style: { display: "flex", flexGrow: 1, flexDirection: "column", justifyContent: "flex-end" } }, [
      contentBody({ kind, story, accent, size, height, whyItMatters, question, source, imageName, credit }),
    ]),
    slideFooter({ accent, size, index, total, hint }),
  ]);
  return el("div", {
    style: { position: "relative", display: "flex", width: size, height, backgroundColor: THEME.bg, fontFamily: THEME.body },
  }, [...slideBackground({ image: slideImage, accent, size, height }), contentScrim(size, height), foreground]);
}

// The cover slide — its own FULL-BLEED layout (the body slides use the unified
// contentSlideTree scaffold). The editorial image fills the frame; a bottom-
// weighted scrim guarantees the hook
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
  if (attribution) metaRow.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.024), fontWeight: 700, color: MUTED, letterSpacing: 1, textShadow: THEME.textShadow } }, attribution));
  metaRow.push(el("div", { style: { display: "flex", fontSize: Math.round(size * 0.026), color: FG, marginLeft: "auto", textShadow: THEME.textShadow } }, "Swipe to read →"));
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
  const slideList = slides || footballSlidesFor(football) || carouselSlidesFor(whyItMatters, question, storyHasNumbers(story));
  const total = slideList.length;
  // Highest-authority source issuer — footer attribution on the numbers slide.
  const source = coverSource(story);

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

  // Resolve real imagery once, up front, and spread it across the carousel. Each
  // content slide gets its OWN visual, best-effort and in parallel. The COVER is
  // sourced strictly: a lead PERSON photo, else an editorial illustration, else
  // (last resort) a CONTAINED org logo / place image, else the gradient floor — so
  // a logo or country flag never heroes the cover above an illustration, and never
  // bleeds full-frame. Body slides take any other entity image, captioned. Runs for
  // withPortrait OR football (football covers still resolve a lead player-face).
  let portrait = null;
  const bodyImageByKind = {};
  // What the COVER ended up showing: "photo" (licensed person photo), "illustration"
  // (Tier-2 generated), "logo" (a contained org/place last resort), or "none" (the
  // gradient floor). Surfaced on the cover slide so the generator can HOLD a weak
  // cover (logo/none) for review instead of auto-posting it. Left undefined when
  // imagery is disabled (withPortrait off) — then the generator never gates on it.
  let coverImagery;
  if (withPortrait || football) {
    // Every news slide carries a full-bleed image (photo → illustration → gradient
    // floor), including numbers / engagement / cta — derived from the slide list in
    // canonical order so it aligns with the generator's plannedIllustrationCount.
    const contentKinds = imageSlideKinds(slideList);
    // planEntityImagery is the single source of truth for cover/body sourcing —
    // shared with plannedIllustrationCount so the generated illustration count can't
    // drift from this allocation. The cover photo is a lead PERSON only; the lead
    // org/place is reserved as the cover's last resort (Pass 3) and kept off the
    // body slides so the same logo never appears on both.
    const { hasCover, coverSpec, coverFallbackSpec, photoBodyKinds, bodySpecs } = planEntityImagery(story, contentKinds);
    const specByKind = {};
    if (hasCover) specByKind.cover = coverSpec;
    // engagement is intentionally absent from photoBodyKinds (cross-story MCQ), so
    // it never claims a current-story entity photo — it keeps the gradient floor.
    photoBodyKinds.forEach((k, i) => { specByKind[k] = bodySpecs[i] || null; });

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
    //
    // illustrationUrls is POSITIONALLY aligned to the gap slots: illustration.js
    // writes one scene per gap in order (scene 0 echoes the cover hook), and a
    // per-image failure leaves a `null` at that slot. So DO NOT compact it — a
    // leading/middle null would otherwise shift every later scene onto the wrong
    // slide (e.g. the cover would inherit slide 2's scene). Keep the slots as-is
    // and let the null-guard drop the failed one to the gradient floor.
    const ill = Array.isArray(illustrationUrls) ? illustrationUrls : [];
    const gapKinds = contentKinds.filter((k) => !photoByKind[k]);
    const illByKind = {};
    await Promise.all(gapKinds.map(async (k, i) => {
      if (!ill[i]) return; // no scene for this slot (never generated, or it failed) → gradient floor
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
    // The cover gets its own full-bleed layout; football body slides use the
    // football scaffold; every other news slide (what / numbers / key points / why
    // / engagement / cta) renders through the ONE unified full-bleed scaffold.
    const tree = kind === "cover"
      ? coverTree({ story, accent, category, size, height, portrait, coverHook, coverHighlight, highlightMode })
      : football
        ? footballSlideTree({ kind, football, accent, category, index, total, size, height, img: fbImg, nextKind: slideList[index + 1] })
        : contentSlideTree({ kind, story, accent, category, index, total, size, height, slideImage: bodyImageByKind[kind] || null, whyItMatters, question: kind === "engagement" ? question : null, source, nextKind: slideList[index + 1] });
    const svg = await satori(tree, { width, height, fonts });
    const { buffer, contentType } = rasterize(svg, { width, format });
    out.push({ buffer, contentType, width, height, slideType: kind, index, ...(kind === "cover" ? { coverImagery } : {}) });
  }
  return out;
}

export { SHAPES, CAROUSEL_SLIDES, FOOTBALL_SLIDES, footballSlidesFor, coverDateLine, firstSentences };
