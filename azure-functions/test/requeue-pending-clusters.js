#!/usr/bin/env node
// Requeue all PENDING clusters to synthesize-queue.
//
// Use this after an Anthropic credit outage to replay clusters that got
// stuck in PROCESSING and were reset back to PENDING in Supabase.
//
// Usage:
//   node test/requeue-pending-clusters.js                         # 10 per batch, 30s delay
//   node test/requeue-pending-clusters.js --batch 20 --delay 60  # custom batch/delay (seconds)
//   node test/requeue-pending-clusters.js --dry-run               # list without sending

import { supabase, sbClient, cleanup } from "./helpers.js";

const DRY_RUN    = process.argv.includes("--dry-run");
const BATCH_SIZE = Number(process.argv[process.argv.indexOf("--batch") + 1]  || 10);
const DELAY_SEC  = Number(process.argv[process.argv.indexOf("--delay") + 1]  || 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log(`\n=== Requeue PENDING clusters → synthesize-queue${DRY_RUN ? " [DRY RUN]" : ""} ===`);
  console.log(`    batch=${BATCH_SIZE}  delay=${DELAY_SEC}s between batches\n`);

  const { data: clusters, error } = await supabase
    .from("clusters")
    .select("id, category_id, cluster_score, updated_at")
    .eq("status", "PENDING")
    .order("cluster_score", { ascending: false }); // highest quality first

  if (error) throw new Error(`fetch clusters: ${error.message}`);

  if (!clusters || clusters.length === 0) {
    console.log("No PENDING clusters found — nothing to requeue.");
    process.exit(0);
  }

  console.log(`Found ${clusters.length} PENDING clusters.\n`);

  if (DRY_RUN) {
    for (const c of clusters) {
      console.log(`  id=${c.id}  category=${c.category_id}  score=${c.cluster_score}`);
    }
    console.log("\n[dry-run] No messages sent.");
    process.exit(0);
  }

  const sender = sbClient.createSender("synthesize-queue");
  let sent = 0;
  const totalBatches = Math.ceil(clusters.length / BATCH_SIZE);

  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const batch     = clusters.slice(i, i + BATCH_SIZE);
    const batchNum  = Math.floor(i / BATCH_SIZE) + 1;

    for (const c of batch) {
      await sender.sendMessages({
        body: { cluster_id: c.id, category_id: c.category_id },
        messageId: String(c.id),
      });
      sent++;
    }

    console.log(`Batch ${batchNum}/${totalBatches}: sent ${batch.length} messages (total ${sent})`);

    if (i + BATCH_SIZE < clusters.length) {
      console.log(`  waiting ${DELAY_SEC}s before next batch...`);
      await sleep(DELAY_SEC * 1000);
    }
  }

  await sender.close();
  console.log(`\nDone. Sent ${sent} messages to synthesize-queue.`);
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
