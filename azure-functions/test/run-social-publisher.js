#!/usr/bin/env node
// Live invocation of the social publisher — publishes due APPROVED X posts to X.
// Requires X auth env (X_ACCESS_TOKEN, or X_CLIENT_ID + X_REFRESH_TOKEN).
//
// SAFETY: this posts PUBLICLY to the configured X account. Approve exactly the
// post(s) you intend to publish before running. The per-day cap also bounds it.
//
// Usage: node test/run-social-publisher.js

import { supabase, cleanup, fakeContext } from "./helpers.js";
import { publishApprovedPosts } from "../lib/social/social-publisher.js";

const ctx = fakeContext("social-publisher");

try {
  // Show what is due before publishing.
  const { data: due } = await supabase
    .from("social_posts")
    .select("id, platform, audience_geo, status, post_text")
    .in("status", ["APPROVED", "SCHEDULED"])
    .is("platform_post_id", null);

  console.log(`\nDue to publish: ${due?.length || 0}`);
  for (const p of due || []) console.log(`  ${p.platform} ${p.id} — ${p.post_text.slice(0, 60)}`);

  const res = await publishApprovedPosts({ supabase, logger: ctx.log });
  console.log(`\nResult:`, JSON.stringify(res));
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await cleanup();
  process.exit(process.exitCode || 0);
}
