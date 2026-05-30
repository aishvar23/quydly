#!/usr/bin/env node
// Read-only verification for Phase 1 candidate selection.
// Runs the real Supabase queries via selectEligibleStories WITHOUT inserting
// candidates or enqueueing anything — just reports what would be selected.
//
// Usage: node test/verify-social-candidates.js

import { supabase, cleanup } from "./helpers.js";
import { selectEligibleStories } from "../lib/social/social-candidates.js";
import { classifySensitivity } from "../lib/social/social-safety.js";
import FLAGS from "../lib/flags.js";

try {
  console.log("\n=== Social candidate selection (dry run, no writes) ===\n");
  console.log("Thresholds:", JSON.stringify(FLAGS.social));

  const pairs = await selectEligibleStories(supabase, { now: new Date(), flags: FLAGS.social });

  console.log(`\nEligible (story, geo) pairs: ${pairs.length}\n`);

  const byGeo = {};
  const bySensitivity = {};
  for (const p of pairs) {
    byGeo[p.audienceGeo] = (byGeo[p.audienceGeo] || 0) + 1;
    const s = classifySensitivity(p.story);
    bySensitivity[s] = (bySensitivity[s] || 0) + 1;
  }
  console.log("By geo:        ", JSON.stringify(byGeo));
  console.log("By sensitivity:", JSON.stringify(bySensitivity), "\n");

  for (const p of pairs.slice(0, 8)) {
    console.log(
      `  story ${p.story.id} [${p.audienceGeo}] rel=${p.relevanceScore} ` +
      `score=${p.story.story_score} sens=${classifySensitivity(p.story)} — ` +
      `${String(p.story.headline).slice(0, 70)}`
    );
  }
  if (pairs.length > 8) console.log(`  … and ${pairs.length - 8} more`);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await cleanup();
}
