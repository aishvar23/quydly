// Story card renderer. Design §8 (reach).
//
// Renders a branded headline card as a PNG, so social posts carry media (the
// single biggest reach lever on X, and the asset Instagram requires before it
// can publish). Pure-JS pipeline — Satori (JSX-like → SVG) then resvg (SVG →
// PNG) — so it runs in an Azure Function with no headless browser.
//
//   renderStoryCard(story, { shape }) → { buffer, contentType, width, height }
//
// shape: "landscape" (1600×900, X) | "square" (1080×1080, Instagram).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

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

// Satori accepts a React-element-shaped object literal ({ type, props }), so we
// build the tree by hand and avoid a JSX/build step.
function el(type, props, children) {
  return { type, props: { ...props, children } };
}

function cardTree({ headline, category, accent, width, height }) {
  const pad = Math.round(width * 0.075);
  return el("div", {
    style: {
      width, height, display: "flex", flexDirection: "column",
      justifyContent: "space-between", backgroundColor: BG,
      padding: pad, fontFamily: "Lato",
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
        fontSize: Math.round(width * (headline.length > 90 ? 0.052 : 0.066)),
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

export async function renderStoryCard(story, { shape = "landscape" } = {}) {
  const { width, height } = SHAPES[shape] || SHAPES.landscape;
  const accent = ACCENT[story?.category_id] || DEFAULT_ACCENT;
  const headline = oneLine(story?.headline) || "Today's news quiz";
  const category = oneLine(story?.category_id || "news");
  const fonts = await loadFonts();

  const svg = await satori(
    cardTree({ headline, category, accent, width, height }),
    { width, height, fonts }
  );

  const png = new Resvg(svg, { background: BG, fitTo: { mode: "width", value: width } })
    .render()
    .asPng();

  return { buffer: png, contentType: "image/png", width, height };
}

export { SHAPES };
