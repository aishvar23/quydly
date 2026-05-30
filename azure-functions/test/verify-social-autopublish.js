#!/usr/bin/env node
// Read-only verification for Phase 5 auto-approval gate.
// Runs evaluateAutoApproval over real recent stories and reports which would
// qualify for auto-publish and why. NO writes, NO posting — purely diagnostic.
//
// Usage: node test/verify-social-autopublish.js

import { supabase, cleanup } from "./helpers.js";
import { evaluateAutoApproval, classifySensitivity } from "../lib/social/social-safety.js";
import FLAGS from "../lib/flags.js";

const AUTO = FLAGS.social.autoApprove;

try {
  console.log("\n=== Phase 5 auto-approval gate (dry run, no writes) ===");
  console.log("SOCIAL_AUTO_PUBLISH_ENABLED:", process.env.SOCIAL_AUTO_PUBLISH_ENABLED || "(unset → OFF)");
  console.log("Gate:", JSON.stringify(AUTO), "\n");

  const sinceIso = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data: stories, error } = await supabase
    .from("stories")
    .select("id, headline, category_id, story_score, confidence_score, source_count, source_documents, summary, key_points")
    .gte("published_at", sinceIso)
    .gte("story_score", FLAGS.social.minStoryScore)
    .order("story_score", { ascending: false })
    .limit(50);
  if (error) throw error;

  let eligible = 0;
  const sens = {};
  for (const s of stories || []) {
    const level = classifySensitivity(s);
    sens[level] = (sens[level] || 0) + 1;
    const r = evaluateAutoApproval(s, { flags: AUTO });
    if (r.eligible) {
      eligible++;
      console.log(`  ✅ story ${s.id} [${s.category_id}] score=${s.story_score} conf=${s.confidence_score} — ${String(s.headline).slice(0, 60)}`);
    }
  }

  console.log(`\nScanned ${stories?.length || 0} stories · sensitivity ${JSON.stringify(sens)}`);
  console.log(`Auto-approval eligible: ${eligible} (capped at ${AUTO.maxPerDay}/day when enabled)`);
  console.log("Note: gate is OFF by default — no candidate is auto-approved unless SOCIAL_AUTO_PUBLISH_ENABLED=true.");
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await cleanup();
  process.exit(process.exitCode || 0);
}
