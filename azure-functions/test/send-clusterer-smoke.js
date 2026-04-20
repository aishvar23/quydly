#!/usr/bin/env node
// Phase 6.7 smoke — runs the article-clusterer (timer-triggered in prod)
// against whatever unclustered DONE articles are currently in the DB, prints
// a terse before/after summary, and peeks synthesize-queue. Does NOT verify
// geo aggregation — run verify-clusterer-geo.js once this completes.
//
// Usage:
//   # Prerequisite: have unclustered DONE articles in raw_articles. Either
//   # wait for the live pipeline, or run send-geo-smoke.js + let the
//   # scraper drain the queue first.
//
//   node test/send-clusterer-smoke.js     # run clusterer once
//   node test/verify-clusterer-geo.js     # verify clusters have geo fields
//
// Safe to run repeatedly: the clusterer is idempotent on clustered_at +
// status, and duplicate synthesize-queue sends are guarded by the
// synthesis_queued_at cooldown.

import articleClusterer from "../article-clusterer/index.js";
import { supabase, sbClient, fakeContext, cleanup } from "./helpers.js";

const ctx = fakeContext("send-clusterer-smoke");

try {
  console.log("\n=== Phase 6.7: Clusterer Smoke Run ===\n");

  const { count: unclusteredBefore } = await supabase
    .from("raw_articles")
    .select("*", { count: "exact", head: true })
    .eq("status", "DONE")
    .is("clustered_at", null);

  const { count: clustersBefore } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true });

  console.log(`Unclustered DONE articles available : ${unclusteredBefore ?? 0}`);
  console.log(`Clusters in DB (before)             : ${clustersBefore ?? 0}`);

  if ((unclusteredBefore ?? 0) === 0) {
    console.log("\nNo unclustered articles to process. Seed the pipeline first.");
  } else {
    console.log("\nRunning article-clusterer...");
    const start = Date.now();
    await articleClusterer(ctx, { isPastDue: false });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Clusterer completed in ${elapsed}s`);

    const { count: unclusteredAfter } = await supabase
      .from("raw_articles")
      .select("*", { count: "exact", head: true })
      .eq("status", "DONE")
      .is("clustered_at", null);

    const { count: clustersAfter } = await supabase
      .from("clusters")
      .select("*", { count: "exact", head: true });

    const articlesProcessed = (unclusteredBefore ?? 0) - (unclusteredAfter ?? 0);
    const clustersDelta     = (clustersAfter ?? 0) - (clustersBefore ?? 0);

    console.log("\n── Delta ──");
    console.log(`  articles clustered this run : ${articlesProcessed}`);
    console.log(`  clusters before → after     : ${clustersBefore} → ${clustersAfter} (+${clustersDelta})`);
    console.log(`  still unclustered           : ${unclusteredAfter ?? 0}`);

    const receiver = sbClient.createReceiver("synthesize-queue", { receiveMode: "peekLock" });
    const peeked = await receiver.peekMessages(10);
    console.log(`  synthesize-queue peeked     : ${peeked.length}`);
    for (const msg of peeked) {
      console.log(`    - cluster_id=${msg.body?.cluster_id} category=${msg.body?.category_id}`);
    }
    await receiver.close();

    console.log("\nDone — run `node test/verify-clusterer-geo.js` to check geo fields on updated clusters.");
  }
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
