#!/usr/bin/env node
// Populate lib/social/football-backgrounds.json with generic, full-bleed football
// backgrounds (stadiums, crowds, floodlights, trophies) from Pexels.
//
// Pexels only — its license allows free commercial use, modification, downloading,
// and no attribution is required for the content. (Unsplash was rejected: its API
// Guidelines forbid non-automated/branded use of the kind we need.) We still
// capture the photographer for the light credit Pexels' API guidelines request.
// The renderer's footballBackground() crops these with objectFit:cover, so we
// store the sized CDN URL (1080×1350, fit=crop) directly in the manifest.
//
// Build-time only. Usage:
//   PEXELS_API_KEY=... node scripts/fetch-football-backgrounds.js
//
// Re-runnable: it overwrites the manifest. Spot-check the result, then commit.
// `type` is "image" for every entry; "clip" is reserved for a future Reels path.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "lib", "social", "football-backgrounds.json");

const PEXELS_KEY = process.env.PEXELS_API_KEY || "";
const PER_MOOD = Number(process.env.BACKGROUNDS_PER_MOOD) || 6;

// mood → search queries. Avoid anything implying a specific real team/match.
const MOOD_QUERIES = {
  neutral: ["empty football stadium", "soccer pitch grass", "football stadium seats"],
  win: ["football fans celebrating", "soccer crowd celebration", "football supporters scarves"],
  defeat: ["empty stadium night", "football stadium rain", "stadium floodlights moody"],
  "knockout-night": ["football stadium floodlights night", "soccer stadium night lights"],
  final: ["football trophy", "soccer trophy silver", "stadium confetti"],
  derby: ["packed football stadium crowd", "football terrace crowd"],
  "champions-league": ["football stadium night europe", "grand stadium night football"],
};

async function pexels(query, n) {
  if (!PEXELS_KEY) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${n}&orientation=portrait`;
  const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
  if (!res.ok) { console.warn(`pexels ${res.status} for "${query}"`); return []; }
  const json = await res.json();
  return (json.photos || []).map((p) => ({
    url: `${p.src.original}?auto=compress&w=1080&h=1350&fit=crop`,
    type: "image", slug: String(p.id), source: "pexels",
    // Captured for the light credit Pexels' API guidelines request (the renderer
    // shows "Photo: <photographer> / Pexels" on slides using a Pexels background).
    photographer: p.photographer || null,
    photographerUrl: p.photographer_url || null,
    pexelsUrl: p.url || null,
  }));
}

async function collectMood(queries, target) {
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    if (out.length >= target) break;
    for (const e of await pexels(q, target)) {
      if (out.length >= target) break;
      if (seen.has(e.url)) continue;
      seen.add(e.url);
      out.push(e);
    }
  }
  return out;
}

async function main() {
  if (!PEXELS_KEY) {
    console.error("Set PEXELS_API_KEY (get one free at https://www.pexels.com/api/). Nothing fetched.");
    process.exit(1);
  }
  const moods = {};
  for (const [mood, queries] of Object.entries(MOOD_QUERIES)) {
    const imgs = await collectMood(queries, PER_MOOD);
    moods[mood] = imgs;
    console.log(`${mood}: ${imgs.length} images`);
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: "Generic full-bleed football backgrounds (Pexels, commercial-use). type=image; clip reserved for Reels. Each entry carries photographer for a light credit.",
    moods,
  };
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nWrote ${OUT}. Spot-check the URLs, then commit.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
