// reel-music.js — picks a royalty-free background music bed for a Reel from
// assets/audio/ (Mixkit Free License — commercial use, no attribution; see
// assets/audio/README.md). Deterministic per seed so a story's reel is stable
// but the feed varies. Returns null when no bed is bundled (→ silent reel).
//
// NOT Instagram's native/trending audio — the Graph API cannot attach IG library
// music to API-published Reels, and a real chart song would be a copyright strike.

import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "audio");
let _beds = null;

function beds() {
  if (_beds) return _beds;
  try {
    _beds = existsSync(AUDIO_DIR)
      ? readdirSync(AUDIO_DIR).filter((f) => /\.(mp3|m4a|aac|wav)$/i.test(f)).sort().map((f) => join(AUDIO_DIR, f))
      : [];
  } catch {
    _beds = [];
  }
  return _beds;
}

export function pickMusicBed(seed = 0) {
  const list = beds();
  if (!list.length) return null;
  return list[Math.abs(Math.trunc(seed)) % list.length];
}

export function hasMusicBeds() {
  return beds().length > 0;
}

export function _resetMusicBeds() {
  _beds = null;
}
