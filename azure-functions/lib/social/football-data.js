// football-data.js — detect that a Quydly story is a real football match and
// resolve sourced match/league data from football-data.org v4 (free tier).
//
// Pure ESM, no satori/resvg imports (safe to import outside the cards branch).
// BEST-EFFORT: every public function returns null on any miss and never throws
// into the generator loop. A wrong match would mean a real IG post with a wrong
// score, so `resolveFootballContext` is deliberately conservative — see the
// guardrail in resolveMatch(): it returns a context ONLY when it can pin down a
// single FINISHED match pairing both story teams in a supported competition.
//
// Factual-safety rule: we render ONLY sourced numbers. No fabricated win
// probabilities/odds/standings — the "win probability" slide is built from the
// real last-5 `form` string the standings endpoint already returns.

import { normalizeTeamKey } from "./club-colors.js";

const API_BASE = "https://api.football-data.org/v4";
const FETCH_TIMEOUT_MS = 4000;
// football-data.org auto-throttles and reports the budget via response headers
// (X-Requests-Available-Minute / X-RequestCounter-Reset). Per their guidance we
// drive throttling off those headers: a small base spacing avoids micro-bursts,
// and when a response says zero requests remain this minute we wait for the
// counter reset. BASE_SPACING_MS is env-overridable (tests set it to 0).
const BASE_SPACING_MS = 300;
const MATCH_WINDOW_DAYS = 2; // published_at ± this many days.
const SIMILARITY_THRESHOLD = 0.6;

// Free-tier competitions: football-data.org code → display + detection keywords.
// Keep keyword regexes word-bounded to avoid false positives.
const FREE_TIER = [
  { code: "PL", name: "Premier League", kw: /\bpremier league\b|\bepl\b/i },
  { code: "PD", name: "La Liga", kw: /\bla ?liga\b|\bprimera divisi[oó]n\b/i },
  { code: "SA", name: "Serie A", kw: /\bserie a\b/i },
  { code: "BL1", name: "Bundesliga", kw: /\bbundesliga\b/i },
  { code: "FL1", name: "Ligue 1", kw: /\bligue ?1\b/i },
  { code: "CL", name: "Champions League", kw: /\bchampions league\b|\bucl\b/i },
  { code: "WC", name: "World Cup", kw: /\bworld cup\b/i },
  { code: "EC", name: "European Championship", kw: /\beuro(?:s| \d{4}|pean championship)\b/i },
  { code: "ELC", name: "Championship", kw: /\bchampionship\b(?!.*\bchampions league\b)/i },
  { code: "DED", name: "Eredivisie", kw: /\beredivisie\b/i },
  { code: "PPL", name: "Primeira Liga", kw: /\bprimeira liga\b|\bliga portugal\b/i },
  { code: "BSA", name: "Brasileirão", kw: /\bbrasileir[aã]o\b|\bbrazil(?:ian)? s[eé]rie a\b/i },
];
const FREE_TIER_CODES = new Set(FREE_TIER.map((c) => c.code));

// Domestic club → competition code hint, used only when no competition keyword
// is present. A wrong hint cannot produce a wrong post: the match must still be
// FINISHED and pair BOTH teams in that competition's data, else we return null.
const CLUB_COMP_HINT = {
  arsenal: "PL", "aston villa": "PL", chelsea: "PL", everton: "PL", fulham: "PL",
  liverpool: "PL", "manchester city": "PL", "manchester united": "PL",
  "newcastle united": "PL", "nottingham forest": "PL", "tottenham hotspur": "PL",
  "tottenham": "PL", "west ham united": "PL", brighton: "PL",
  "real madrid": "PD", barcelona: "PD", "atletico madrid": "PD", sevilla: "PD",
  "athletic bilbao": "PD", "real sociedad": "PD", "real betis": "PD", valencia: "PD",
  juventus: "SA", inter: "SA", internazionale: "SA", milan: "SA", napoli: "SA",
  roma: "SA", lazio: "SA", atalanta: "SA", fiorentina: "SA",
  "bayern munich": "BL1", "bayern munchen": "BL1", "borussia dortmund": "BL1",
  "rb leipzig": "BL1", "bayer leverkusen": "BL1", "eintracht frankfurt": "BL1",
  "paris saint germain": "FL1", psg: "FL1", marseille: "FL1", lyon: "FL1",
  monaco: "FL1", lille: "FL1",
  ajax: "DED", psv: "DED", "psv eindhoven": "DED", feyenoord: "DED",
  benfica: "PPL", porto: "PPL", sporting: "PPL", "sporting cp": "PPL",
  flamengo: "BSA", palmeiras: "BSA",
};

// Tokens that mark a non-football sport — their presence vetoes detection.
const OTHER_SPORT = /\b(cricket|ipl|test match|odi|t20|nba|nfl|super bowl|touchdown|quarterback|formula ?1|\bf1\b|grand prix|tennis|wimbledon|\batp\b|ufc|nhl|ice hockey|rugby|baseball|mlb)\b/i;

// Football-specific signals (a generic "football" mention alone must NOT pass).
const FOOTBALL_KW = /\b(premier league|la ?liga|serie a|bundesliga|ligue ?1|champions league|ucl|europa league|world cup|euro(?:s|pean championship)?|fa cup|uefa|fifa|eredivisie|primeira liga|brasileir[aã]o|soccer)\b/i;

// --- helpers ---------------------------------------------------------------

function entityNames(story) {
  const out = [];
  const flat = Array.isArray(story?.primary_entities) ? story.primary_entities : [];
  for (const n of flat) if (n) out.push(String(n));
  const rich = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  for (const e of rich) if (e?.name) out.push(String(e.name));
  return out;
}

function storyText(story) {
  return [story?.headline, story?.summary].filter(Boolean).join(" ");
}

// Bigram Dice coefficient — cheap fuzzy similarity for team-name matching.
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = bigrams(a), B = bigrams(b);
  let overlap = 0;
  for (const [g, n] of A) if (B.has(g)) overlap += Math.min(n, B.get(g));
  const total = (a.length - 1) + (b.length - 1);
  return total ? (2 * overlap) / total : 0;
}

// --- public: detection -----------------------------------------------------

export function isFootballStory(story) {
  if (!story) return false;
  const text = `${storyText(story)} ${entityNames(story).join(" ")}`;
  if (OTHER_SPORT.test(text)) return false;
  if (FOOTBALL_KW.test(text)) return true;
  // story_type=sports passes only with a soccer-specific corroborating signal:
  // a known club entity or a "X vs Y" scoreline phrasing.
  if (String(story.story_type || "").toLowerCase() === "sports") {
    const keys = entityNames(story).map(normalizeTeamKey);
    if (keys.some((k) => CLUB_COMP_HINT[k] || k in CLUB_COMP_HINT)) return true;
    if (/\b\w+\s+\d+\s*[-–]\s*\d+\s+\w+\b/.test(text)) return true;
  }
  return false;
}

// --- rate-limited, cached fetch -------------------------------------------

let _chain = Promise.resolve();
let _lastAt = 0;
let _available = null; // X-Requests-Available-Minute from the last response
let _resetAt = 0; // when the per-minute counter resets (ms epoch)
const _cache = new Map(); // path → parsed json (process lifetime, per UTC day)

async function fdFetch(path, { apiKey, fetchImpl, logger }) {
  const key = path;
  if (_cache.has(key)) return _cache.get(key);
  // Serialize calls so the header-derived budget is read sequentially.
  const run = _chain.then(async () => {
    // Header-aware throttle: if the last response said zero requests remain this
    // minute, wait for the counter reset before calling again.
    if (_available !== null && _available <= 0 && Date.now() < _resetAt) {
      const waitReset = _resetAt - Date.now() + 250;
      logger?.warn?.("football_data_waiting_reset", { path, ms: waitReset });
      await new Promise((r) => setTimeout(r, waitReset));
    }
    // A small base spacing avoids micro-bursts; env-overridable (tests set 0).
    const envInterval = Number(process.env.FOOTBALL_DATA_MIN_INTERVAL_MS);
    const minInterval = Number.isFinite(envInterval) ? envInterval : BASE_SPACING_MS;
    const wait = minInterval - (Date.now() - _lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${API_BASE}${path}`, {
        headers: { "X-Auth-Token": apiKey || "" },
        signal: controller.signal,
        redirect: "follow",
      });
      _lastAt = Date.now();
      // Update the budget from the throttle headers (best-effort; mocks omit them).
      const avail = Number(res?.headers?.get?.("X-Requests-Available-Minute"));
      const reset = Number(res?.headers?.get?.("X-RequestCounter-Reset"));
      if (Number.isFinite(avail)) _available = avail;
      if (Number.isFinite(reset)) _resetAt = Date.now() + reset * 1000;
      if (res?.status === 429) {
        logger?.warn?.("football_data_rate_limited", { path });
        return null;
      }
      if (!res || !res.ok) return null;
      const json = await res.json();
      _cache.set(key, json);
      return json;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
  _chain = run.then(() => undefined, () => undefined);
  return run;
}

// --- competition + team resolution ----------------------------------------

function detectCompetitions(story) {
  const text = storyText(story);
  const byKeyword = FREE_TIER.filter((c) => c.kw.test(text));
  if (byKeyword.length) return byKeyword;
  // Fallback: infer a single domestic competition from matched club entities.
  const codes = new Set();
  for (const name of entityNames(story)) {
    const hint = CLUB_COMP_HINT[normalizeTeamKey(name)];
    if (hint) codes.add(hint);
  }
  return FREE_TIER.filter((c) => codes.has(c.code));
}

// Match story entities against a competition's teams. Returns the two best team
// matches (home/away agnostic) each with its similarity score, or null.
function matchTeams(story, teams) {
  const entKeys = entityNames(story).map(normalizeTeamKey).filter(Boolean);
  const scored = [];
  for (const t of teams) {
    const candidates = [t.name, t.shortName, t.tla].filter(Boolean).map(normalizeTeamKey);
    let best = 0;
    for (const ent of entKeys) {
      for (const c of candidates) {
        const s = c === ent ? 1 : (c.includes(ent) || ent.includes(c)) && Math.min(c.length, ent.length) >= 4 ? 0.85 : similarity(c, ent);
        if (s > best) best = s;
      }
    }
    if (best >= SIMILARITY_THRESHOLD) scored.push({ team: t, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  // De-dup by team id, keep the two distinct strongest.
  const seen = new Set();
  const top = [];
  for (const s of scored) {
    if (seen.has(s.team.id)) continue;
    seen.add(s.team.id);
    top.push(s);
    if (top.length === 2) break;
  }
  return top.length === 2 ? top : null;
}

function withinWindow(utcDate, publishedAt) {
  const t = Date.parse(utcDate);
  const p = Date.parse(publishedAt);
  if (!Number.isFinite(t) || !Number.isFinite(p)) return false;
  return Math.abs(t - p) <= MATCH_WINDOW_DAYS * 86400000;
}

// --- public: resolve -------------------------------------------------------

export async function resolveFootballContext(story, { fetchImpl = fetch, apiKey, now, logger } = {}) {
  try {
    if (!apiKey || !story) return null;
    const publishedAt = story.published_at || (now ? now() : new Date()).toISOString();
    const comps = detectCompetitions(story);
    if (!comps.length) return null;

    for (const comp of comps) {
      if (!FREE_TIER_CODES.has(comp.code)) continue; // guardrail #1
      const teamsResp = await fdFetch(`/competitions/${comp.code}/teams`, { apiKey, fetchImpl, logger });
      const teams = teamsResp?.teams;
      if (!Array.isArray(teams) || !teams.length) continue;

      const matched = matchTeams(story, teams); // guardrail #2 + #4
      if (!matched) continue;
      const [tA, tB] = matched.map((m) => m.team);

      // guardrail #3: exactly one FINISHED match in the window pairing both teams.
      const pub = Date.parse(publishedAt);
      const from = new Date(pub - MATCH_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const to = new Date(pub + MATCH_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const matchesResp = await fdFetch(
        `/competitions/${comp.code}/matches?status=FINISHED&dateFrom=${from}&dateTo=${to}`,
        { apiKey, fetchImpl, logger },
      );
      const all = Array.isArray(matchesResp?.matches) ? matchesResp.matches : [];
      const pairing = all.filter((m) => {
        const ids = [m.homeTeam?.id, m.awayTeam?.id];
        return ids.includes(tA.id) && ids.includes(tB.id) && m.status === "FINISHED" && withinWindow(m.utcDate, publishedAt);
      });
      if (pairing.length !== 1) continue; // zero / ambiguous → next comp or null
      const m = pairing[0];

      const standingsResp = await fdFetch(`/competitions/${comp.code}/standings`, { apiKey, fetchImpl, logger });
      // League comps return one TOTAL table; group comps (World Cup, Euros, the
      // Champions League group stage) return one TOTAL table PER GROUP. Prefer the
      // table that contains BOTH involved teams (their group), else the first.
      const totals = (standingsResp?.standings || []).filter((s) => s.type === "TOTAL");
      let table = [];
      for (const s of totals) {
        const ids = (s.table || []).map((r) => r.team?.id);
        if (ids.includes(tA.id) && ids.includes(tB.id)) { table = s.table; break; }
      }
      if (!table.length && totals[0]) table = totals[0].table || [];

      return buildContext({ comp, match: m, table, teams: { [tA.id]: tA, [tB.id]: tB } });
    }
    return null;
  } catch (err) {
    logger?.warn?.("football_resolve_failed", { error: String(err) });
    return null;
  }
}

function rowFor(table, teamId) {
  return table.find((r) => r.team?.id === teamId) || null;
}

function buildContext({ comp, match, table }) {
  const home = match.homeTeam, away = match.awayTeam;
  const fullTime = match.score?.fullTime || {};
  const homeRow = rowFor(table, home.id);
  const awayRow = rowFor(table, away.id);

  const involvedRows = table
    .filter((r) => r.team?.id === home.id || r.team?.id === away.id)
    .map((r) => ({ ...r, involved: true }));

  const insightLines = [];
  if (homeRow && awayRow) {
    insightLines.push(`${home.shortName || home.name} sit ${ordinal(homeRow.position)}, ${away.shortName || away.name} ${ordinal(awayRow.position)}.`);
  }
  if (homeRow?.form || awayRow?.form) {
    insightLines.push(`Form (last 5): ${home.tla || home.shortName} ${formPoints(homeRow?.form)} pts · ${away.tla || away.shortName} ${formPoints(awayRow?.form)} pts.`);
  }

  return {
    competition: { code: comp.code, name: comp.name, emblemUrl: match.competition?.emblem || null },
    match: {
      id: match.id,
      status: match.status,
      utcDate: match.utcDate,
      home: { id: home.id, name: home.name, shortName: home.shortName, tla: home.tla, crest: home.crest },
      away: { id: away.id, name: away.name, shortName: away.shortName, tla: away.tla, crest: away.crest },
      score: { home: fullTime.home ?? null, away: fullTime.away ?? null },
      winner: match.score?.winner || null,
    },
    standings: {
      table: table.map((r) => ({
        position: r.position,
        team: { id: r.team?.id, name: r.team?.name, shortName: r.team?.shortName, tla: r.team?.tla, crest: r.team?.crest },
        played: r.playedGames,
        goalDifference: r.goalDifference,
        points: r.points,
        form: r.form || null,
        involved: r.team?.id === home.id || r.team?.id === away.id,
      })),
      involved: involvedRows.map((r) => ({ position: r.position, points: r.points, goalDifference: r.goalDifference, form: r.form || null, teamId: r.team?.id })),
    },
    insights: { lines: insightLines },
  };
}

// W=3, D=1, L=0 over the last-5 `form` string (e.g. "W,W,D,L,W"). Real points only.
export function formPoints(form) {
  if (!form) return 0;
  return String(form)
    .split(/[ ,]+/)
    .filter(Boolean)
    .reduce((sum, r) => sum + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
}

function ordinal(n) {
  if (!Number.isFinite(n)) return String(n);
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Test seam: reset module-level caches between unit tests.
export function _resetFootballDataCache() {
  _cache.clear();
  _chain = Promise.resolve();
  _lastAt = 0;
  _available = null;
  _resetAt = 0;
}

export const _internal = { detectCompetitions, matchTeams, similarity, FREE_TIER_CODES };
