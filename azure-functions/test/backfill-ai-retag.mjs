#!/usr/bin/env node
// One-time backfill: re-tag already-scraped, NOT-YET-CLUSTERED AI-topic articles
// from tech/finance/world to `ai`, so the next article-clusterer run can thicken
// AI clusters with independent press coverage. Uses the SAME isAiTopic() as the
// live scrape-time re-tag path, so detection is identical.
//
// Already-clustered articles are intentionally skipped — they're locked into
// existing (tech) clusters and re-tagging them changes nothing.
//
// Usage (from azure-functions/):
//   node test/backfill-ai-retag.mjs            # DRY RUN: counts + sample, no writes
//   node test/backfill-ai-retag.mjs --apply    # write category_id='ai'

import { supabase, cleanup } from "./helpers.js";
import {
  isAiTopic,
  RETAG_SOURCE_CATEGORIES,
  RETAG_TARGET_CATEGORY,
} from "../lib/ai-topic.js";

const APPLY = process.argv.includes("--apply");
const PAGE  = 1000;

try {
  console.log(`\n=== AI re-tag backfill (${APPLY ? "APPLY" : "DRY RUN"}) ===\n`);
  console.log(`source categories: ${RETAG_SOURCE_CATEGORIES.join(", ")} → ${RETAG_TARGET_CATEGORY}`);
  console.log(`filter: status='DONE' AND clustered_at IS NULL\n`);

  // ── 1. Scan all candidate articles, collect isAiTopic matches ─────────────
  // Full scan first, then update by id — so the paging window never shifts
  // under us (we only mutate category_id, but the filter keys on it).
  let offset  = 0;
  let scanned = 0;
  const matches = [];

  for (;;) {
    const { data, error } = await supabase
      .from("raw_articles")
      .select("id, title, description, content, domain, category_id")
      .in("category_id", RETAG_SOURCE_CATEGORIES)
      .eq("status", "DONE")
      .is("clustered_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(`scan: ${error.message}`);
    if (!data || data.length === 0) break;

    scanned += data.length;
    for (const a of data) {
      if (isAiTopic({ title: a.title, description: a.description, content: a.content })) {
        matches.push(a);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // ── 2. Report ─────────────────────────────────────────────────────────────
  console.log(`scanned ${scanned} unclustered DONE articles in ${RETAG_SOURCE_CATEGORIES.join("/")}`);
  console.log(`${matches.length} match isAiTopic → would re-tag to '${RETAG_TARGET_CATEGORY}'\n`);

  const byCat    = {};
  const byDomain = {};
  for (const m of matches) {
    byCat[m.category_id]   = (byCat[m.category_id]   || 0) + 1;
    byDomain[m.domain ?? "(none)"] = (byDomain[m.domain ?? "(none)"] || 0) + 1;
  }
  console.log("by source category:", byCat);
  console.log("top domains:");
  for (const [d, n] of Object.entries(byDomain).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(4)}  ${d}`);
  }
  console.log("\nsample (first 25 titles — eyeball for false positives):");
  for (const m of matches.slice(0, 25)) {
    console.log(`  [${m.category_id}] ${m.domain} — ${m.title}`);
  }

  // ── 3. Apply (optional) ────────────────────────────────────────────────────
  if (!APPLY) {
    console.log("\nDRY RUN — no writes. Re-run with --apply once the sample looks clean.");
  } else if (matches.length === 0) {
    console.log("\nNothing to update.");
  } else {
    const ids   = matches.map(m => m.id);
    const CHUNK = 200;
    let updated = 0;

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("raw_articles")
        .update({ category_id: RETAG_TARGET_CATEGORY })
        .in("id", chunk);

      if (error) throw new Error(`update: ${error.message}`);
      updated += chunk.length;
      console.log(`  updated ${updated}/${ids.length}`);
    }

    console.log(`\n✅ re-tagged ${updated} articles to '${RETAG_TARGET_CATEGORY}'.`);
    console.log("Run `npm run test:clusterer` to cluster them (or wait for the 2h timer).");
  }
} finally {
  await cleanup();
}
