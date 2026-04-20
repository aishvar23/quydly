#!/usr/bin/env node
// Phase 6.7 smoke verification — inspect clusters whose updated_at falls in
// the last 15 minutes and confirm primary_geos, source_countries, and
// geo_scores are populated by the clusterer.
//
// Usage: node test/verify-clusterer-geo.js
//
// Run after `node test/send-clusterer-smoke.js`. A cluster only appears here
// if the smoke run actually adopted a new article into it (that's what
// touches updated_at); empty result means the clusterer loaded clusters but
// didn't modify any — seed the scrape-queue with articles that share
// high-signal entities so clusters grow.

import { supabase, cleanup } from "./helpers.js";

const WINDOW_MINUTES = 15;

try {
  console.log(`\n=== Cluster geo aggregation verification (last ${WINDOW_MINUTES} min) ===\n`);

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("clusters")
    .select(
      "id, category_id, status, " +
      "primary_geos, source_countries, geo_scores, " +
      "article_ids, unique_domains, updated_at"
    )
    .gte("updated_at", windowStart)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No clusters touched in window. Did send-clusterer-smoke.js");
    console.log("actually adopt articles into clusters? (clusters_below_quality");
    console.log("or clusters_skipped_no_match means nothing was updated.)");
    process.exitCode = 1;
  } else {
    console.log(`Clusters inspected: ${rows.length}\n`);

    // ── Per-cluster detail ─────────────────────────────────────────────────
    console.log("── Per-cluster (most recent first) ──");
    for (const c of rows.slice(0, 12)) {
      const pg = Array.isArray(c.primary_geos)     ? c.primary_geos     : [];
      const sc = Array.isArray(c.source_countries) ? c.source_countries : [];
      const gs = c.geo_scores ?? {};
      const members = Array.isArray(c.article_ids) ? c.article_ids.length : 0;
      console.log(
        `  #${String(c.id).padEnd(5)} [${c.status}] ` +
        `cat=${(c.category_id ?? "").padEnd(8)} ` +
        `members=${String(members).padStart(3)} ` +
        `primary_geos=[${pg.join(",")}] ` +
        `source_countries=[${sc.join(",")}] ` +
        `geo_scores=${JSON.stringify(gs)}`
      );
    }

    // ── Coverage rollup ────────────────────────────────────────────────────
    const total = rows.length;
    const withPrimaryGeos     = rows.filter(c => (c.primary_geos?.length     ?? 0) > 0).length;
    const withSourceCountries = rows.filter(c => (c.source_countries?.length ?? 0) > 0).length;
    const withIndiaPrimary    = rows.filter(c => (c.primary_geos     ?? []).includes("in")).length;
    const withIndiaSource     = rows.filter(c => (c.source_countries ?? []).includes("in")).length;
    const bothAudienceKeys    = rows.filter(c => {
      const s = c.geo_scores ?? {};
      return typeof s.india === "number" && typeof s.global === "number";
    }).length;

    console.log("\n── Coverage ──");
    console.log(`  total                          : ${total}`);
    console.log(`  primary_geos non-empty         : ${withPrimaryGeos}/${total}`);
    console.log(`  source_countries non-empty     : ${withSourceCountries}/${total}`);
    console.log(`  'in' in primary_geos           : ${withIndiaPrimary}/${total}`);
    console.log(`  'in' in source_countries       : ${withIndiaSource}/${total}`);
    console.log(`  geo_scores has india+global    : ${bothAudienceKeys}/${total}`);

    // ── Pass/fail ──────────────────────────────────────────────────────────
    // source_countries must be populated on every cluster in the window.
    // It's a direct dedupe of raw_articles.source_country which Phase 5 sets
    // from the feed registry; an empty array signals either a feed-registry
    // miss or a regression in Phase 6.2 aggregation. primary_geos may
    // legitimately be empty if no member mentions a known geo, so we only
    // require at least one cluster with primary_geos set. geo_scores must
    // carry all configured audience keys on every cluster.
    const missingSourceCountries = rows.filter(c => (c.source_countries?.length ?? 0) === 0);
    const failures = [];
    if (missingSourceCountries.length > 0) {
      const ids = missingSourceCountries.slice(0, 5).map(c => c.id).join(", ");
      const more = missingSourceCountries.length > 5 ? ` (+${missingSourceCountries.length - 5} more)` : "";
      failures.push(`${missingSourceCountries.length}/${total} clusters missing source_countries — cluster ids: ${ids}${more}`);
    }
    if (withPrimaryGeos === 0)      failures.push("no cluster has primary_geos populated — Phase 6.3 likely broken");
    if (bothAudienceKeys < total)   failures.push("some clusters missing india or global key in geo_scores — Phase 6.4 likely broken");

    console.log("");
    if (failures.length === 0) {
      console.log("PASS — cluster geo aggregation is writing expected fields.");
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
