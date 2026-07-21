#!/usr/bin/env node
// Render-only verification for the FIFA/football carousel. Posts NOTHING.
// Writes each slide JPEG to ./.football-slides/ for the operator to EYEBALL
// against the reference look (433 / B/R / FotMob / Sofascore).
//
// Usage:
//   node test/verify-ig-football-carousel.js --fixture     # synthetic match, no network/keys
//   node test/verify-ig-football-carousel.js <storyId>     # real story: resolve + render (needs keys)
//
// <storyId> mode loads local.settings.json, fetches the story from Supabase,
// runs isFootballStory + resolveFootballContext (football-data.org), PRINTS the
// resolved match/standings/insights, then renders. It never publishes.

import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { renderCarouselSlides } from "../lib/social/card-renderer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", ".football-slides");
const FIXTURE = process.argv.includes("--fixture");
// --match "Home|Away|YYYY-MM-DD" → synthesize a story for a REAL match and
// resolve it against the LIVE football-data.org API (no Supabase needed).
const matchArg = process.argv.find((a) => a.startsWith("--match="))?.slice("--match=".length)
  || (process.argv.includes("--match") ? process.argv[process.argv.indexOf("--match") + 1] : null);
const storyId = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== matchArg);

// A synthetic resolved-football context shaped exactly like resolveFootballContext().
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
      { position: 4, team: { id: 61, name: "Chelsea FC", shortName: "Chelsea", tla: "CHE" }, played: 31, goalDifference: 20, points: 60, form: "D,W,L,W,W", involved: false },
      { position: 5, team: { id: 73, name: "Tottenham Hotspur FC", shortName: "Tottenham", tla: "TOT" }, played: 31, goalDifference: 15, points: 55, form: "L,W,D,W,L", involved: false },
      { position: 6, team: { id: 58, name: "Aston Villa FC", shortName: "Aston Villa", tla: "AVL" }, played: 31, goalDifference: 10, points: 52, form: "W,D,D,L,W", involved: false },
      { position: 8, team: { id: 66, name: "Manchester United FC", shortName: "Man United", tla: "MUN" }, played: 31, goalDifference: 6, points: 46, form: "L,D,W,L,D", involved: true },
    ],
    involved: [
      { position: 1, points: 73, goalDifference: 42, form: "W,W,D,W,W", teamId: 64 },
      { position: 8, points: 46, goalDifference: 6, form: "L,D,W,L,D", teamId: 66 },
    ],
  },
  insights: {
    lines: [
      "Liverpool sit 1st, Manchester United 8th.",
      "Form (last 5): LIV 13 pts · MUN 5 pts.",
      "Salah's brace decided it — two goals in 34 first-half minutes.",
    ],
  },
};

const FIXTURE_STORY = {
  id: "fixture-football",
  category_id: "world",
  published_at: "2026-06-23T20:00:00Z",
  headline: "Liverpool beat Manchester United 2-1 at Anfield",
  summary: "Mohamed Salah scored twice as Liverpool moved clear at the top.",
  primary_entities: ["Liverpool", "Manchester United", "Mohamed Salah"],
};

function writeSlides(slides) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const s of slides) {
    const ext = s.contentType === "image/png" ? "png" : "jpg";
    const path = join(OUT_DIR, `${s.index}-${s.slideType}.${ext}`);
    writeFileSync(path, s.buffer);
    console.log(`  wrote ${path}  (${s.width}x${s.height}, ${s.buffer.length} bytes)`);
  }
}

async function main() {
  if (FIXTURE || (!storyId && !matchArg)) {
    console.log("FIXTURE MODE — synthetic Premier League match, no network/keys.\n");
    const coverHook = "United's title hopes just cracked at Anfield";
    const slides = await renderCarouselSlides(FIXTURE_STORY, { football: FIXTURE_CONTEXT, coverHook, coverHighlight: "cracked" });
    console.log(`Rendered ${slides.length} slides: ${slides.map((s) => s.slideType).join(" → ")}\n`);
    writeSlides(slides);
    console.log(`\nEyeball ${OUT_DIR} against the reference look (433 / B/R / FotMob / Sofascore).`);
    return;
  }

  // Load env (for FOOTBALL_DATA_API_KEY / Supabase creds).
  const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
  Object.assign(process.env, settings.Values);
  const { isFootballStory, resolveFootballContext } = await import("../lib/social/football-data.js");

  // --match mode: synthesize a story for a real match, resolve LIVE, render.
  if (matchArg) {
    const [home, away, date] = matchArg.split("|");
    const story = {
      id: "live-match", category_id: "world", story_type: "sports",
      published_at: `${(date || "2026-06-23").trim()}T20:00:00Z`,
      headline: `${home} face ${away} at the World Cup`,
      summary: `A World Cup match between ${home} and ${away}.`,
      primary_entities: [home.trim(), away.trim()],
    };
    console.log(`LIVE resolve for: ${home} vs ${away} (${date})`);
    console.log(`isFootballStory: ${isFootballStory(story)}`);
    const football = await resolveFootballContext(story, { apiKey: process.env.FOOTBALL_DATA_API_KEY, logger: console });
    if (!football) { console.log("\nNo match resolved (guardrail) → standard carousel would render."); return; }
    console.log("\nResolved:", JSON.stringify(football.match, null, 2));
    console.log("Insights:", JSON.stringify(football.insights.lines, null, 2));
    const slides = await renderCarouselSlides(story, { football, coverHook: `${home} vs ${away}: the World Cup numbers` });
    console.log(`\nRendered ${slides.length}: ${slides.map((s) => s.slideType).join(" → ")}\n`);
    writeSlides(slides);
    console.log(`\nEyeball ${OUT_DIR}.`);
    return;
  }

  // Real-story mode: fetch from Supabase, resolve, render (no publish).
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: story, error } = await supabase
    .from("stories")
    .select("id, category_id, story_type, published_at, headline, summary, key_points, primary_entities, primary_entities_enriched")
    .eq("id", storyId)
    .single();
  if (error || !story) throw new Error(`story ${storyId} not found: ${error?.message}`);

  console.log(`Story ${storyId}: ${story.headline}`);
  console.log(`isFootballStory: ${isFootballStory(story)}`);
  const football = await resolveFootballContext(story, { apiKey: process.env.FOOTBALL_DATA_API_KEY, logger: console });
  if (!football) {
    console.log("\nNo football match resolved → would render the STANDARD carousel. Nothing football-specific to eyeball.");
    return;
  }
  console.log("\nResolved match:", JSON.stringify(football.match, null, 2));
  console.log("Involved standings:", JSON.stringify(football.standings.involved, null, 2));
  console.log("Insights:", JSON.stringify(football.insights.lines, null, 2));

  const slides = await renderCarouselSlides(story, { football });
  console.log(`\nRendered ${slides.length} slides: ${slides.map((s) => s.slideType).join(" → ")}\n`);
  writeSlides(slides);
  console.log(`\nEyeball ${OUT_DIR} before any live enable.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
