// football-backgrounds.js — picks a generic full-bleed background image for a
// football slide from the curated library manifest (football-backgrounds.json,
// populated by scripts/fetch-football-backgrounds.js from Unsplash + Pexels).
//
// Best-effort: until the manifest is populated, pickBackground() returns null and
// the renderer falls back to crest/emblem over a team-accent gradient. The
// manifest reserves a `type` field (`image` now, `clip` for a future Reels path).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "football-backgrounds.json");
let _manifest = null;

async function loadManifest() {
  if (_manifest) return _manifest;
  try {
    _manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    _manifest = { moods: {} };
  }
  return _manifest;
}

// Map a resolved match to a background mood (the emotional register of the slide).
export function moodForMatch(football, slideType) {
  if (!football?.match) return "neutral";
  const comp = football.competition?.code;
  if (comp === "CL" || comp === "EC" || comp === "WC") return "knockout-night";
  const { home, away } = football.match.score || {};
  if (slideType === "scoreboard" && Number.isFinite(home) && Number.isFinite(away)) {
    if (home === away) return "neutral";
    return "win"; // a decisive result → celebratory register
  }
  return "neutral";
}

// Deterministic pick from the pools for {competition, mood}, falling back to
// neutral. `seed` (e.g. match id) keeps a carousel cohesive but the feed varied.
// Returns the full entry { url, photographer, ... } (or null) so the renderer can
// show the light credit Pexels' API guidelines request.
export async function pickBackground({ mood = "neutral", competition = null, seed = 0 } = {}) {
  const m = await loadManifest();
  const moods = m?.moods || {};
  const pools = [];
  if (competition && Array.isArray(moods[competition])) pools.push(...moods[competition]);
  if (mood && Array.isArray(moods[mood])) pools.push(...moods[mood]);
  if (Array.isArray(moods.neutral)) pools.push(...moods.neutral);
  const imgs = pools.filter((e) => e && e.url && (e.type || "image") === "image");
  if (!imgs.length) return null;
  const idx = Math.abs(Math.trunc(seed)) % imgs.length;
  return imgs[idx];
}

// The light credit line for a background entry ("Photo: <name> / Pexels").
export function backgroundCredit(entry) {
  if (!entry || (entry.source && entry.source !== "pexels")) return entry?.photographer ? `Photo: ${entry.photographer}` : "";
  return entry.photographer ? `Photo: ${entry.photographer} / Pexels` : "Photo: Pexels";
}

// Test seam.
export function _resetBackgroundManifest() {
  _manifest = null;
}
