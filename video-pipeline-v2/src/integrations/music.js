'use strict';

const fs = require('fs');
const path = require('path');

// Music-bed picker. Looks in public/music/<storyType>/ for an audio file
// matching the story type; falls back to public/music/default/ for a
// universal bed; returns null when nothing's there. Caller is responsible
// for licensing what they drop in — the pipeline doesn't ship any tracks.
//
// Convention:
//   public/music/legal_scandal/*.mp3   — tense, procedural
//   public/music/geopolitics_world/*  — measured, official
//   public/music/finance_markets/*    — sober, analytic
//   public/music/election_result/*    — civic, momentous
//   public/music/natural_disaster/*   — restrained, no melodrama
//   public/music/tech_cyber/*         — synthetic, low-key tense
//   public/music/culture_entertainment/* — upbeat, contemporary
//   public/music/general/*            — neutral newsroom bed
//   public/music/default/*            — fallback when no type-specific track
//
// First file in the directory wins (alphabetical). Drop multiple files in
// the same dir for variety; a future revision can pick randomly.

const SUPPORTED_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

function pickMusicTrack(storyType, { publicDir }) {
  if (!publicDir) return null;
  const musicRoot = path.join(publicDir, 'music');
  if (!fs.existsSync(musicRoot)) return null;

  const candidates = [
    storyType ? path.join(musicRoot, storyType) : null,
    path.join(musicRoot, 'default'),
  ].filter(Boolean);

  for (const dir of candidates) {
    const file = firstAudioFile(dir);
    if (file) {
      return {
        path: file,
        sourceDir: path.relative(publicDir, dir),
      };
    }
  }
  return null;
}

function firstAudioFile(dir) {
  if (!fs.existsSync(dir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }
  const sorted = entries
    .filter((name) => SUPPORTED_EXT.has(path.extname(name).toLowerCase()))
    .sort();
  if (sorted.length === 0) return null;
  return path.join(dir, sorted[0]);
}

module.exports = {
  pickMusicTrack,
  SUPPORTED_EXT,
};
