#!/usr/bin/env node
// Verify DB state after running smoke/load tests.
//
// Usage: node test/verify.js
//
// Checks:
//   - scrape_queue: status distribution
//   - raw_articles: status distribution, recent counts by hour
//   - clusters: status distribution, eligible count
//   - stories: total, recent (last 24h)
//   - Redis: domain semaphore keys (should be 0 after all processing)

import { supabase, redis, cleanup } from "./helpers.js";

try {
  console.log("\n=== Pipeline Verification Report ===\n");

  // ── scrape_queue ──────────────────────────────────────────────────────────
  console.log("── scrape_queue ──");
  let sqStats = null;
  try {
    const { data } = await supabase
      .rpc("count_by_status", { table_name: "scrape_queue" });
    sqStats = data;
  } catch (e) {
    // RPC might not exist, use fallback
  }

  if (sqStats) {
    for (const row of sqStats) console.log(`  ${row.status}: ${row.count}`);
  } else {
    // Fallback: manual counts
    for (const status of ["PENDING", "PROCESSING", "DONE", "FAILED", "LOW_QUALITY", "PARTIAL"]) {
      const { count } = await supabase
        .from("scrape_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", status);
      if (count > 0) console.log(`  ${status}: ${count}`);
    }
  }

  const { count: sqTotal } = await supabase
    .from("scrape_queue")
    .select("*", { count: "exact", head: true });
  console.log(`  TOTAL: ${sqTotal}`);

  // ── raw_articles ──────────────────────────────────────────────────────────
  console.log("\n── raw_articles ──");
  for (const status of ["DONE", "FAILED", "LOW_QUALITY", "PARTIAL"]) {
    const { count } = await supabase
      .from("raw_articles")
      .select("*", { count: "exact", head: true })
      .eq("status", status);
    if (count > 0) console.log(`  ${status}: ${count}`);
  }

  const { count: raTotal } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true });
  console.log(`  TOTAL: ${raTotal}`);

  // Recent articles by hour (last 6 hours)
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: recentArticles } = await supabase
    .from("raw_articles")
    .select("scraped_at")
    .gte("scraped_at", sixHoursAgo)
    .order("scraped_at", { ascending: true });

  if (recentArticles && recentArticles.length > 0) {
    console.log(`  Last 6h: ${recentArticles.length} articles`);
    const byHour = {};
    for (const a of recentArticles) {
      const hour = a.scraped_at?.slice(0, 13) ?? "unknown";
      byHour[hour] = (byHour[hour] || 0) + 1;
    }
    for (const [hour, count] of Object.entries(byHour)) {
      console.log(`    ${hour}: ${count}`);
    }
  }

  // Unclustered count
  const { count: unclustered } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true })
    .eq("status", "DONE")
    .is("clustered_at", null);
  console.log(`  Unclustered (DONE, clustered_at=NULL): ${unclustered}`);

  // ── clusters ──────────────────────────────────────────────────────────────
  console.log("\n── clusters ──");
  for (const status of ["PENDING", "PROCESSING", "PROCESSED"]) {
    const { count } = await supabase
      .from("clusters")
      .select("*", { count: "exact", head: true })
      .eq("status", status);
    if (count > 0) console.log(`  ${status}: ${count}`);
  }

  const { count: clTotal } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true });
  console.log(`  TOTAL: ${clTotal}`);

  // Eligible clusters (score >= 20, articles >= 2, domains >= 2)
  const { data: eligible } = await supabase
    .from("clusters")
    .select("id, cluster_score, article_ids, unique_domains")
    .eq("status", "PENDING")
    .gte("cluster_score", 20);

  const eligibleCount = (eligible ?? []).filter(
    c => (c.article_ids?.length ?? 0) >= 2 && (c.unique_domains?.length ?? 0) >= 2
  ).length;
  console.log(`  Eligible for synthesis: ${eligibleCount}`);

  // ── stories ───────────────────────────────────────────────────────────────
  console.log("\n── stories ──");
  const { count: stTotal } = await supabase
    .from("stories")
    .select("*", { count: "exact", head: true });
  console.log(`  TOTAL: ${stTotal}`);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: stRecent } = await supabase
    .from("stories")
    .select("*", { count: "exact", head: true })
    .gte("published_at", oneDayAgo);
  console.log(`  Last 24h: ${stRecent}`);

  // Sample recent stories
  const { data: sampleStories } = await supabase
    .from("stories")
    .select("id, headline, story_score, category_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (sampleStories && sampleStories.length > 0) {
    console.log("  Recent stories:");
    for (const s of sampleStories) {
      console.log(`    [${s.category_id}] score=${s.story_score} — ${s.headline?.slice(0, 60)}`);
    }
  }

  // ── Redis domain semaphores ───────────────────────────────────────────────
  console.log("\n── Redis domain semaphores ──");
  const keys = await redis.keys("domain_inflight:*");
  if (keys.length === 0) {
    console.log("  No active semaphores (expected after processing completes)");
  } else {
    console.log(`  ${keys.length} active semaphore(s):`);
    for (const key of keys) {
      const val = await redis.get(key);
      console.log(`    ${key} = ${val}`);
    }
  }

  console.log("\n=== Done ===\n");
} catch (err) {
  console.error("Error:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
