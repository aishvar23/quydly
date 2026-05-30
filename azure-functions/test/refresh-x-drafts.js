#!/usr/bin/env node
// One-off: refresh existing X drafts to the new no-URL CTA.
// Deletes non-POSTED X posts that still contain a URL, then regenerates them
// deterministically (anthropic=null → no Claude cost, no API calls). FB/IG
// drafts are left untouched (generator skips existing platforms).
//
// Usage: node test/refresh-x-drafts.js

import { supabase, cleanup, fakeContext } from "./helpers.js";
import { generateSocialPosts } from "../lib/social/social-post-generator.js";

const ctx = fakeContext("refresh-x-drafts");

try {
  // X drafts (not yet posted) that still embed a URL.
  const { data: stale, error } = await supabase
    .from("social_posts")
    .select("id, candidate_id, post_text")
    .eq("platform", "x")
    .in("status", ["PENDING_REVIEW", "APPROVED"])
    .ilike("post_text", "%quydly.com%");
  if (error) throw error;

  console.log(`Stale X drafts with URL: ${stale.length}`);
  if (!stale.length) { console.log("Nothing to refresh."); }
  else {
    const ids = stale.map((s) => s.id);
    const candidateIds = [...new Set(stale.map((s) => s.candidate_id).filter(Boolean))];

    const { error: delErr } = await supabase.from("social_posts").delete().in("id", ids);
    if (delErr) throw delErr;
    console.log(`Deleted ${ids.length} stale X drafts; regenerating ${candidateIds.length} candidate(s) deterministically…`);

    for (const cid of candidateIds) {
      const r = await generateSocialPosts({ supabase, anthropic: null, candidateId: cid, logger: ctx.log });
      console.log(`  candidate ${cid}: +${r.created} created, ${r.skipped} skipped`);
    }
  }

  // Verify: no non-posted X draft contains a URL.
  const { data: check } = await supabase
    .from("social_posts")
    .select("id")
    .eq("platform", "x")
    .in("status", ["PENDING_REVIEW", "APPROVED"])
    .ilike("post_text", "%quydly.com%");
  console.log(`\nRemaining non-posted X drafts with URL: ${check?.length ?? "?"} (want 0)`);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await cleanup();
  process.exit(process.exitCode || 0);
}
