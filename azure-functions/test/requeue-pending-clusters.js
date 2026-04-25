#!/usr/bin/env node
// Requeue all PENDING clusters to synthesize-queue.
//
// Use this after an Anthropic credit outage to replay clusters that got
// stuck in PROCESSING and were reset back to PENDING in Supabase.
//
// Usage:
//   node test/requeue-pending-clusters.js            # enqueue all PENDING clusters
//   node test/requeue-pending-clusters.js --dry-run  # list what would be enqueued

import { supabase, sbClient, cleanup } from "./helpers.js";

const DRY_RUN = process.argv.includes("--dry-run");

try {
  console.log(`\n=== Requeue PENDING clusters → synthesize-queue${DRY_RUN ? " [DRY RUN]" : ""} ===\n`);

  const { data: clusters, error } = await supabase
    .from("clusters")
    .select("id, category_id, cluster_score, updated_at")
    .eq("status", "PENDING")
    .order("updated_at", { ascending: true });

  if (error) throw new Error(`fetch clusters: ${error.message}`);

  if (!clusters || clusters.length === 0) {
    console.log("No PENDING clusters found — nothing to requeue.");
    process.exit(0);
  }

  console.log(`Found ${clusters.length} PENDING clusters:`);
  for (const c of clusters) {
    console.log(`  id=${c.id}  category=${c.category_id}  score=${c.cluster_score}  updated=${c.updated_at}`);
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] No messages sent.");
    process.exit(0);
  }

  const sender = sbClient.createSender("synthesize-queue");
  let sent = 0;

  for (const c of clusters) {
    await sender.sendMessages({
      body: { cluster_id: c.id, category_id: c.category_id },
      messageId: String(c.id),
    });
    sent++;
  }

  await sender.close();
  console.log(`\nSent ${sent} messages to synthesize-queue.`);
  console.log("Run `func start` in azure-functions/ to process them.");
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
