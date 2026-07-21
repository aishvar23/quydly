#!/usr/bin/env node
// Build lib/social/football-knowledge.json — a curated, version-controlled dataset
// of teams for the ~12 free-tier competitions: name, aliases, TLA, crest, stadium,
// country (and a manager slot to curate). Pulled from football-data.org /teams;
// team colors come from lib/social/club-colors.js (football-data.org doesn't give
// reliable colors). Managers change often — this file carries an `as_of` date and
// is RE-RUNNABLE; curate managers manually after a run.
//
// Build-time only. Usage:
//   FOOTBALL_DATA_API_KEY=... node scripts/build-football-knowledge.js
//
// Honors the ~10 req/min free-tier budget by spacing calls ~6.5s apart.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { teamAccent, normalizeTeamKey } from "../lib/social/club-colors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "lib", "social", "football-knowledge.json");
const API = "https://api.football-data.org/v4";
const KEY = process.env.FOOTBALL_DATA_API_KEY || "";

const COMPS = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "SA", name: "Serie A" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "CL", name: "Champions League" },
  { code: "DED", name: "Eredivisie" },
  { code: "PPL", name: "Primeira Liga" },
  { code: "BSA", name: "Brasileirão" },
  { code: "ELC", name: "Championship" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fd(path) {
  const res = await fetch(`${API}${path}`, { headers: { "X-Auth-Token": KEY } });
  if (res.status === 429) { console.warn("rate limited, backing off 30s"); await sleep(30000); return fd(path); }
  if (!res.ok) { console.warn(`${res.status} for ${path}`); return null; }
  return res.json();
}

async function main() {
  if (!KEY) { console.error("Set FOOTBALL_DATA_API_KEY."); process.exit(1); }
  const teams = {};
  const competitions = [];
  for (const c of COMPS) {
    const resp = await fd(`/competitions/${c.code}/teams`);
    competitions.push({ code: c.code, name: c.name, emblem: resp?.competition?.emblem || null });
    for (const t of resp?.teams || []) {
      const key = normalizeTeamKey(t.name);
      if (!key || teams[key]) continue;
      teams[key] = {
        canonicalName: t.name,
        aliases: [t.shortName, t.tla].filter(Boolean),
        threeLetterCode: t.tla || null,
        crestUrl: t.crest || null,
        primaryColor: teamAccent(t.name),
        stadium: t.venue || null,
        country: t.area?.name || null,
        manager: null, // curate manually — changes too often to trust an API snapshot
        competition: c.code,
      };
    }
    console.log(`${c.code}: ${(resp?.teams || []).length} teams`);
    await sleep(6500); // free-tier spacing
  }
  const out = {
    as_of: new Date().toISOString().slice(0, 10),
    note: "Teams for the football carousel. Managers are null by default — curate manually (they change often). Re-run to refresh names/crests/stadiums.",
    competitions,
    teams,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${OUT} (${Object.keys(teams).length} teams). Curate managers, then commit.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
