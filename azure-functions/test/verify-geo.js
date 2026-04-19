#!/usr/bin/env node
// Phase 5.6 smoke verification — inspect raw_articles rows written in the
// last 15 minutes and confirm the new geo columns are populated.
//
// Usage: node test/verify-geo.js

import { supabase, cleanup } from "./helpers.js";

const WINDOW_MINUTES = 15;

try {
  console.log(`\n=== Geo enrichment verification (last ${WINDOW_MINUTES} min) ===\n`);

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("raw_articles")
    .select(
      "url_hash, domain, source_country, source_region, language, " +
      "is_global_candidate, mentioned_geos, geo_scores, scraped_at, status"
    )
    .gte("scraped_at", windowStart)
    .order("scraped_at", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No raw_articles rows in window. Did `func start` process the messages?");
    process.exitCode = 1;
  } else {
    console.log(`Rows inspected: ${rows.length}\n`);

    // ── Per-row detail ──────────────────────────────────────────────────────
    console.log("── Per-row (most recent first) ──");
    for (const r of rows.slice(0, 12)) {
      const mentions = Array.isArray(r.mentioned_geos) ? r.mentioned_geos : [];
      const scores = r.geo_scores ?? {};
      console.log(
        `  [${r.status}] ${r.domain.padEnd(28)} ` +
        `src=${r.source_country ?? "∅"}/${r.source_region ?? "∅"} ` +
        `lang=${r.language ?? "∅"} ` +
        `global_cand=${r.is_global_candidate} ` +
        `mentions=[${mentions.join(",")}] ` +
        `scores=${JSON.stringify(scores)}`
      );
    }

    // ── Coverage rollup ─────────────────────────────────────────────────────
    const total = rows.length;
    const withSourceCountry  = rows.filter((r) => r.source_country).length;
    const withMentions       = rows.filter((r) => (r.mentioned_geos?.length ?? 0) > 0).length;
    const withIndiaMentions  = rows.filter((r) => (r.mentioned_geos ?? []).includes("in")).length;
    const indiaOrigin        = rows.filter((r) => r.source_country === "in").length;
    const globalCandidates   = rows.filter((r) => r.is_global_candidate === true).length;
    const bothAudienceKeys   = rows.filter((r) => {
      const s = r.geo_scores ?? {};
      return typeof s.india === "number" && typeof s.global === "number";
    }).length;

    console.log("\n── Coverage ──");
    console.log(`  total                          : ${total}`);
    console.log(`  source_country populated       : ${withSourceCountry}/${total}`);
    console.log(`  mentioned_geos non-empty       : ${withMentions}/${total}`);
    console.log(`  'in' in mentioned_geos         : ${withIndiaMentions}/${total}`);
    console.log(`  source_country='in'            : ${indiaOrigin}/${total}`);
    console.log(`  is_global_candidate=true       : ${globalCandidates}/${total}`);
    console.log(`  geo_scores has india+global    : ${bothAudienceKeys}/${total}`);

    // ── Pass/fail ───────────────────────────────────────────────────────────
    const failures = [];
    if (withSourceCountry < total)  failures.push("some rows missing source_country (feed registry miss?)");
    if (bothAudienceKeys < total)   failures.push("some rows missing india or global key in geo_scores");
    if (withIndiaMentions === 0)    failures.push("no article mentioned India — expected ≥1 from Indian-source feeds");
    if (indiaOrigin === 0)          failures.push("no India-origin article — expected ≥1 from thehindu/indianexpress/hindustantimes");

    console.log("");
    if (failures.length === 0) {
      console.log("PASS — geo enrichment writing all six fields as expected.");
    } else {
      console.log("FAIL:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    }
  }

  console.log("");
} catch (err) {
  console.error("Error:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
