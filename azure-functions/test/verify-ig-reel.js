#!/usr/bin/env node
// Render-only verification for the FIFA/football REEL. Posts NOTHING.
// Renders the football slides at 9:16, builds the MP4 (music bed if present),
// writes it to ./.football-slides/reel.mp4, prints the ffprobe spec, and extracts
// a couple of frames as JPEGs so the operator can eyeball the visual. The final
// MP4 itself must be watched by a human (a green spec != a good Reel).
//
// Usage:
//   node test/verify-ig-reel.js --fixture            # synthetic PL match, no network
//   node test/verify-ig-reel.js --match "H|A|date"   # real match, resolve LIVE
//   (add MUSIC=path.mp3 to override the bed; omit → first asset bed, else silent)

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { renderCarouselSlides } from "../lib/social/card-renderer.js";
import { renderReelVideo } from "../lib/social/video-renderer.js";
import { pickMusicBed } from "../lib/social/reel-music.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", ".football-slides");
const matchArg = process.argv.find((a) => a.startsWith("--match="))?.slice("--match=".length)
  || (process.argv.includes("--match") ? process.argv[process.argv.indexOf("--match") + 1] : null);

const FIXTURE_CONTEXT = {
  competition: { code: "PL", name: "Premier League", emblemUrl: null },
  match: {
    id: 999001, status: "FINISHED", utcDate: "2026-06-23T18:00:00Z",
    home: { id: 64, name: "Liverpool FC", shortName: "Liverpool", tla: "LIV", crest: null },
    away: { id: 66, name: "Manchester United FC", shortName: "Man United", tla: "MUN", crest: null },
    score: { home: 2, away: 1 }, winner: "HOME_TEAM",
    scorers: [{ name: "Salah", minute: 18 }, { name: "Salah", minute: 52 }, { name: "Fernandes", minute: 79 }],
  },
  standings: {
    table: [
      { position: 1, team: { id: 64, name: "Liverpool FC", shortName: "Liverpool", tla: "LIV" }, played: 31, goalDifference: 42, points: 73, form: "W,W,D,W,W", involved: true },
      { position: 2, team: { id: 57, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS" }, played: 31, goalDifference: 38, points: 70, form: "W,W,W,D,W", involved: false },
      { position: 3, team: { id: 65, name: "Manchester City FC", shortName: "Man City", tla: "MCI" }, played: 31, goalDifference: 35, points: 68, form: "W,L,W,W,D", involved: false },
      { position: 8, team: { id: 66, name: "Manchester United FC", shortName: "Man United", tla: "MUN" }, played: 31, goalDifference: 6, points: 46, form: "L,D,W,L,D", involved: true },
    ],
    involved: [
      { position: 1, points: 73, goalDifference: 42, form: "W,W,D,W,W", teamId: 64 },
      { position: 8, points: 46, goalDifference: 6, form: "L,D,W,L,D", teamId: 66 },
    ],
  },
  insights: { lines: ["Liverpool sit 1st, Manchester United 8th.", "Form (last 5): LIV 13 pts · MUN 5 pts.", "Salah's brace decided it — two goals in 34 first-half minutes."] },
};
const FIXTURE_STORY = {
  id: "fixture-reel", category_id: "world", published_at: "2026-06-23T20:00:00Z",
  headline: "Liverpool beat Manchester United 2-1 at Anfield",
  summary: "Mohamed Salah scored twice as Liverpool moved clear at the top.",
  primary_entities: ["Liverpool", "Manchester United", "Mohamed Salah"],
};

function pickMusic(seed) {
  if (process.env.MUSIC && existsSync(process.env.MUSIC)) return process.env.MUSIC;
  return pickMusicBed(seed);
}

async function resolveFootball() {
  if (!matchArg) return { story: FIXTURE_STORY, football: FIXTURE_CONTEXT, hook: "United's title hopes just cracked at Anfield" };
  const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
  Object.assign(process.env, settings.Values);
  const { isFootballStory, resolveFootballContext } = await import("../lib/social/football-data.js");
  const [home, away, date] = matchArg.split("|");
  const story = {
    id: "live-reel", category_id: "world", story_type: "sports",
    published_at: `${(date || "2026-06-23").trim()}T20:00:00Z`,
    headline: `${home} face ${away} at the World Cup`, summary: `A World Cup match between ${home} and ${away}.`,
    primary_entities: [home.trim(), away.trim()],
  };
  if (!isFootballStory(story)) throw new Error("not detected as football");
  const football = await resolveFootballContext(story, { apiKey: process.env.FOOTBALL_DATA_API_KEY, logger: console });
  if (!football) throw new Error("no match resolved");
  // DEMO ONLY: a real Quydly story already enriches the players named in the
  // article (primary_entities_enriched, licensed Wikipedia photos). The synthetic
  // --match story has none, so resolve a couple of each team's stars from
  // Wikipedia to demonstrate real player FACES on the slides. (The free
  // football-data tier returns no scorers/lineups, so production relies on the
  // story's entity enrichment.)
  story.primary_entities_enriched = await enrichStarPlayers(home.trim(), away.trim());
  return { story, football, hook: `${home} vs ${away}: the World Cup numbers` };
}

// Small demo map of star players per (test) national team — winner's first.
const STAR_PLAYERS = {
  croatia: ["Luka Modrić", "Ivan Perišić"], panama: ["Aníbal Godoy"],
  england: ["Jude Bellingham", "Harry Kane"], ghana: ["Mohammed Kudus"],
  colombia: ["Luis Díaz", "James Rodríguez"], "congo dr": ["Cédric Bakambu"],
  argentina: ["Lionel Messi"], brazil: ["Vinícius Júnior"], france: ["Kylian Mbappé"],
  spain: ["Lamine Yamal"], portugal: ["Cristiano Ronaldo"], netherlands: ["Virgil van Dijk"],
};
async function wikiThumb(name) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`, { headers: { "User-Agent": "quydly-reel-demo/1.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.thumbnail?.source || j?.originalimage?.source || null;
  } catch { return null; }
}
async function enrichStarPlayers(home, away) {
  const names = [...(STAR_PLAYERS[away.toLowerCase()] || []), ...(STAR_PLAYERS[home.toLowerCase()] || [])]; // winner(away in our test) first
  const out = [];
  for (const name of names) {
    const url = await wikiThumb(name);
    if (url) out.push({ name, type: "person", wikipedia_thumbnail_url: url });
  }
  return out;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const { story, football, hook } = await resolveFootball();
  console.log(`Match: ${football.match.home.name} ${football.match.score.home}-${football.match.score.away} ${football.match.away.name} (${football.competition.name})`);

  // Render the proven 4:5 slides; the video-renderer composes each into 9:16
  // (sharp card centred on a blurred extension of the same frame).
  const slides = await renderCarouselSlides(story, { shape: "portrait", football, coverHook: hook, coverHighlight: matchArg ? null : "cracked" });
  console.log(`Rendered ${slides.length} 4:5 frames: ${slides.map((s) => s.slideType).join(" → ")}`);

  const musicPath = pickMusic(football.match.id || 0);
  console.log(`Music bed: ${musicPath || "(none — SILENT reel)"}`);
  const reel = await renderReelVideo(story, { frames: slides, musicPath });

  const out = join(OUT_DIR, "reel.mp4");
  writeFileSync(out, reel.buffer);
  console.log(`\nWrote ${out}  (${reel.width}x${reel.height}, ${reel.durationSec}s, ${(reel.buffer.length / 1e6).toFixed(2)} MB)`);

  // ffprobe the result.
  const probe = JSON.parse(execFileSync(ffprobeStatic.path, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", out]).toString());
  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  console.log(`video : ${v?.codec_name} ${v?.width}x${v?.height} @${eval(v?.r_frame_rate || "0")}fps`);
  console.log(`audio : ${a ? `${a.codec_name} ${a.sample_rate}Hz` : "(none)"}`);
  console.log(`format: ${probe.format.format_name}, ${Number(probe.format.duration).toFixed(2)}s`);
  // Confirm moov-at-front (faststart) for Reels: ftyp/moov before mdat.
  const head = readFileSync(out).subarray(0, 4096).toString("latin1");
  console.log(`faststart (moov before mdat): ${head.indexOf("moov") !== -1 && (head.indexOf("mdat") === -1 || head.indexOf("moov") < head.indexOf("mdat"))}`);

  // Extract frames for an eyeball of the visual.
  for (const t of [1.0, Math.max(2, reel.durationSec / 2), reel.durationSec - 1]) {
    const fp = join(OUT_DIR, `reel-frame-${t.toFixed(1)}s.jpg`);
    execFileSync(ffmpegStatic, ["-y", "-ss", String(t), "-i", out, "-frames:v", "1", "-q:v", "3", fp], { stdio: "ignore" });
  }
  console.log(`Extracted preview frames to ${OUT_DIR}. WATCH reel.mp4 to verify motion + music.`);

  // Assemble the REELS Graph request in DRY-RUN (no Meta call) — confirms the
  // publish path without uploading or posting.
  const ig = await import("../lib/social/instagram-graph.js");
  const dry = await ig.publish({ post_text: "Reel caption" }, {
    creds: { igUserId: "IG", accessToken: "TOK", graphVersion: "v21.0" },
    reelUrl: "https://example.com/reel.mp4", dryRun: true,
  });
  console.log(`REELS dry-run publish: ${dry.platformPostId} (mode=${dry.rawResponse.mode || "reel"})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
