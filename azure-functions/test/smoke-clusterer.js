#!/usr/bin/env node
// Smoke test 6.7 — Run the article-clusterer against real unclustered articles
// already in the DB (from discover + scraper pipeline).
//
// Usage: node test/smoke-clusterer.js
//
// No synthetic data — uses real raw_articles with status=DONE, clustered_at=NULL.

import articleClusterer from "../article-clusterer/index.js";
import { supabase, sbClient, fakeContext, cleanup } from "./helpers.js";

const ctx = fakeContext("smoke-clusterer");

try {
  console.log("\n=== Phase 6.7: Clusterer Smoke Test ===\n");

  // Check how many unclustered articles exist
  const { count: unclustered } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true })
    .eq("status", "DONE")
    .is("clustered_at", null);

  console.log(`Unclustered DONE articles available: ${unclustered}`);

  if (unclustered === 0) {
    console.log("No unclustered articles to process. Run discover + scraper first.");
    process.exit(0);
  }

  // Count clusters before
  const { count: clustersBefore } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true });

  // Run clusterer
  console.log("Running article-clusterer...");
  const start = Date.now();
  await articleClusterer(ctx, { isPastDue: false });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Clusterer completed in ${elapsed}s`);

  // Count clusters after
  const { count: clustersAfter } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true });

  const newClusters = clustersAfter - clustersBefore;
  console.log(`Clusters: ${clustersBefore} → ${clustersAfter} (+${newClusters} new)`);

  // Check how many articles got marked as clustered
  const { count: stillUnclustered } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true })
    .eq("status", "DONE")
    .is("clustered_at", null);

  const articlesProcessed = unclustered - stillUnclustered;
  console.log(`Articles clustered this run: ${articlesProcessed}`);
  console.log(`Still unclustered: ${stillUnclustered}`);

  // Peek synthesize-queue
  const receiver = sbClient.createReceiver("synthesize-queue", { receiveMode: "peekLock" });
  const peeked = await receiver.peekMessages(10);
  console.log(`\nPeeked ${peeked.length} messages in synthesize-queue:`);
  for (const msg of peeked) {
    console.log(`  - cluster_id: ${msg.body?.cluster_id}, category: ${msg.body?.category_id}`);
  }
  await receiver.close();

  // Summary
  console.log("\n--- Result ---");
  if (newClusters > 0 || articlesProcessed > 0) {
    console.log(`PASS: ${newClusters} clusters created/updated, ${articlesProcessed} articles processed, ${peeked.length} queued for synthesis`);
  } else {
    console.log("WARN: 0 clusters formed — articles may lack overlapping entities across domains");
  }
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
