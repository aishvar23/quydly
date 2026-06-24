// Unit tests for the football detection + resolver. Mocked fetch only — no live
// football-data.org calls, no network. Run: node --test test/social-football-data.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.FOOTBALL_DATA_MIN_INTERVAL_MS = "0"; // disable rate-limit spacing in tests

const { isFootballStory, resolveFootballContext, formPoints, _resetFootballDataCache } = await import(
  "../lib/social/football-data.js"
);

// --- isFootballStory -------------------------------------------------------

test("isFootballStory: true for clear football competitions", () => {
  assert.equal(isFootballStory({ headline: "Liverpool win the Premier League title race" }), true);
  assert.equal(isFootballStory({ headline: "Real Madrid reach the Champions League final" }), true);
  assert.equal(isFootballStory({ summary: "The World Cup final ended in dramatic fashion." }), true);
});

test("isFootballStory: false for other sports", () => {
  assert.equal(isFootballStory({ headline: "India win the cricket World Cup", summary: "T20 final thriller" }), false);
  assert.equal(isFootballStory({ headline: "Lakers top the NBA standings" }), false);
  assert.equal(isFootballStory({ headline: "Verstappen wins the F1 Grand Prix" }), false);
  assert.equal(isFootballStory({ headline: "Chiefs win the Super Bowl, late touchdown" }), false);
});

test("isFootballStory: bare 'football' mention does not pass", () => {
  assert.equal(isFootballStory({ headline: "A local football pitch reopens after repairs" }), false);
});

test("isFootballStory: story_type=sports passes only with a club entity", () => {
  assert.equal(
    isFootballStory({ story_type: "sports", headline: "Big result last night", primary_entities: ["Arsenal", "Chelsea"] }),
    true,
  );
  assert.equal(isFootballStory({ story_type: "sports", headline: "Big result last night" }), false);
});

// --- resolver fixtures -----------------------------------------------------

const TEAMS = {
  teams: [
    { id: 64, name: "Liverpool FC", shortName: "Liverpool", tla: "LIV", crest: "https://x/liv.png" },
    { id: 66, name: "Manchester United FC", shortName: "Man United", tla: "MUN", crest: "https://x/mun.png" },
    { id: 57, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS", crest: "https://x/ars.png" },
  ],
};
const STANDINGS = {
  standings: [
    {
      type: "TOTAL",
      table: [
        { position: 1, team: { id: 64, name: "Liverpool FC", shortName: "Liverpool", tla: "LIV" }, playedGames: 30, goalDifference: 40, points: 70, form: "W,W,D,W,W" },
        { position: 8, team: { id: 66, name: "Manchester United FC", shortName: "Man United", tla: "MUN" }, playedGames: 30, goalDifference: 5, points: 45, form: "L,D,W,L,D" },
      ],
    },
  ],
};
const finishedMatch = {
  id: 1001,
  status: "FINISHED",
  utcDate: "2026-06-23T18:00:00Z",
  competition: { emblem: "https://x/pl.png" },
  homeTeam: { id: 64, name: "Liverpool FC", shortName: "Liverpool", tla: "LIV", crest: "https://x/liv.png" },
  awayTeam: { id: 66, name: "Manchester United FC", shortName: "Man United", tla: "MUN", crest: "https://x/mun.png" },
  score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } },
};

function makeFetch(routes) {
  return async (url) => {
    for (const [frag, body] of routes) {
      if (url.includes(frag)) {
        if (body === 429) return { status: 429, ok: false };
        return { status: 200, ok: true, json: async () => body };
      }
    }
    return { status: 404, ok: false };
  };
}

const STORY = {
  published_at: "2026-06-23T20:00:00Z",
  headline: "Liverpool beat Manchester United in the Premier League",
  summary: "A 2-1 win at Anfield.",
  primary_entities: ["Liverpool", "Manchester United"],
};

// --- resolveFootballContext ------------------------------------------------

test("resolve: happy path returns a sourced context", async () => {
  _resetFootballDataCache();
  const fetchImpl = makeFetch([
    ["/competitions/PL/teams", TEAMS],
    ["/competitions/PL/matches", { matches: [finishedMatch] }],
    ["/competitions/PL/standings", STANDINGS],
  ]);
  const ctx = await resolveFootballContext(STORY, { fetchImpl, apiKey: "k" });
  assert.ok(ctx, "expected a context");
  assert.equal(ctx.competition.code, "PL");
  assert.equal(ctx.match.score.home, 2);
  assert.equal(ctx.match.score.away, 1);
  assert.equal(ctx.match.home.tla, "LIV");
  assert.ok(ctx.standings.table.some((r) => r.involved));
  assert.ok(ctx.insights.lines.length >= 1);
});

test("resolve: only one matched team → null", async () => {
  _resetFootballDataCache();
  const story = { ...STORY, primary_entities: ["Liverpool", "Some Random Club"], headline: "Liverpool play in the Premier League" };
  const fetchImpl = makeFetch([
    ["/competitions/PL/teams", TEAMS],
    ["/competitions/PL/matches", { matches: [finishedMatch] }],
    ["/competitions/PL/standings", STANDINGS],
  ]);
  assert.equal(await resolveFootballContext(story, { fetchImpl, apiKey: "k" }), null);
});

test("resolve: two FINISHED pairings in window → ambiguous → null", async () => {
  _resetFootballDataCache();
  const dup = { ...finishedMatch, id: 1002 };
  const fetchImpl = makeFetch([
    ["/competitions/PL/teams", TEAMS],
    ["/competitions/PL/matches", { matches: [finishedMatch, dup] }],
    ["/competitions/PL/standings", STANDINGS],
  ]);
  assert.equal(await resolveFootballContext(STORY, { fetchImpl, apiKey: "k" }), null);
});

test("resolve: non-FINISHED match → null", async () => {
  _resetFootballDataCache();
  const scheduled = { ...finishedMatch, status: "SCHEDULED" };
  const fetchImpl = makeFetch([
    ["/competitions/PL/teams", TEAMS],
    ["/competitions/PL/matches", { matches: [scheduled] }],
    ["/competitions/PL/standings", STANDINGS],
  ]);
  assert.equal(await resolveFootballContext(STORY, { fetchImpl, apiKey: "k" }), null);
});

test("resolve: 429 on teams → null", async () => {
  _resetFootballDataCache();
  const fetchImpl = makeFetch([["/competitions/PL/teams", 429]]);
  assert.equal(await resolveFootballContext(STORY, { fetchImpl, apiKey: "k" }), null);
});

test("resolve: no competition detected → null (no fetch)", async () => {
  _resetFootballDataCache();
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: false, status: 404 }; };
  const story = { ...STORY, headline: "Two teams drew yesterday", summary: "It was a match.", primary_entities: ["Unknown A", "Unknown B"] };
  assert.equal(await resolveFootballContext(story, { fetchImpl, apiKey: "k" }), null);
  assert.equal(called, false);
});

test("resolve: missing apiKey → null", async () => {
  _resetFootballDataCache();
  assert.equal(await resolveFootballContext(STORY, { fetchImpl: makeFetch([]), apiKey: "" }), null);
});

// --- formPoints ------------------------------------------------------------

test("formPoints: W=3 D=1 L=0", () => {
  assert.equal(formPoints("W,W,D,W,W"), 13);
  assert.equal(formPoints("L,D,W,L,D"), 5);
  assert.equal(formPoints(""), 0);
  assert.equal(formPoints(null), 0);
});
