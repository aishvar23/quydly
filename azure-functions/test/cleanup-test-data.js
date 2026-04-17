#!/usr/bin/env node
// Clean up test data seeded by smoke tests.
//
// Usage: node test/cleanup-test-data.js
//
// Removes rows where canonical_url contains 'test-article-' or 'test-cluster-'.
// Does NOT touch real pipeline data.

import { supabase, cleanup } from "./helpers.js";

try {
  console.log("\n=== Cleaning up test data ===\n");

  // raw_articles with test URLs
  const { count: raCount } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true })
    .or("canonical_url.like.%test-article-%,canonical_url.like.%test-cluster-%");

  if (raCount > 0) {
    const { error } = await supabase
      .from("raw_articles")
      .delete()
      .or("canonical_url.like.%test-article-%,canonical_url.like.%test-cluster-%");
    if (error) console.error("raw_articles delete error:", error.message);
    else console.log(`  Deleted ${raCount} test rows from raw_articles`);
  } else {
    console.log("  No test rows in raw_articles");
  }

  // scrape_queue with test URLs
  const { count: sqCount } = await supabase
    .from("scrape_queue")
    .select("*", { count: "exact", head: true })
    .or("canonical_url.like.%test-article-%,canonical_url.like.%test-cluster-%");

  if (sqCount > 0) {
    const { error } = await supabase
      .from("scrape_queue")
      .delete()
      .or("canonical_url.like.%test-article-%,canonical_url.like.%test-cluster-%");
    if (error) console.error("scrape_queue delete error:", error.message);
    else console.log(`  Deleted ${sqCount} test rows from scrape_queue`);
  } else {
    console.log("  No test rows in scrape_queue");
  }

  console.log("\nNote: clusters and stories created from test articles are not deleted.");
  console.log("They are harmless and will age out of the River window naturally.");
  console.log("\n=== Done ===\n");
} catch (err) {
  console.error("Error:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
