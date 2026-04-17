#!/usr/bin/env node
// Smoke test 7.7 + Idempotency test 7.8 — Send cluster IDs to synthesize-queue.
//
// Usage:
//   node test/send-synthesize-messages.js              # sends 5 eligible clusters
//   node test/send-synthesize-messages.js --idempotent  # sends each cluster_id twice
//
// Finds PENDING clusters with score >= 20 in the DB, sends their IDs to
// synthesize-queue. With --idempotent, each ID is sent twice to verify
// the synthesizer's idempotency guard (cluster.status !== 'PENDING' on 2nd pass).

import { supabase, sbClient, cleanup } from "./helpers.js";

const IDEMPOTENT = process.argv.includes("--idempotent");
const COUNT = 5;

try {
  console.log(`\n=== Phase 7.7: Synthesizer Smoke Test${IDEMPOTENT ? " (idempotency)" : ""} ===\n`);

  // Find eligible PENDING clusters
  const { data: clusters, error } = await supabase
    .from("clusters")
    .select("id, category_id, cluster_score, article_ids, unique_domains")
    .eq("status", "PENDING")
    .gte("cluster_score", 20)
    .order("cluster_score", { ascending: false })
    .limit(COUNT);

  if (error) throw new Error(`fetch clusters: ${error.message}`);

  if (!clusters || clusters.length === 0) {
    console.log("No eligible PENDING clusters found.");
    console.log("Run smoke-clusterer.js first to create test clusters.");
    process.exit(0);
  }

  console.log(`Found ${clusters.length} eligible clusters:`);
  for (const c of clusters) {
    console.log(`  - id=${c.id}  score=${c.cluster_score}  articles=${c.article_ids?.length}  domains=${c.unique_domains?.length}`);
  }

  const sender = sbClient.createSender("synthesize-queue");
  let sent = 0;

  for (const c of clusters) {
    const repetitions = IDEMPOTENT ? 2 : 1;
    for (let r = 0; r < repetitions; r++) {
      await sender.sendMessages({
        body: { cluster_id: c.id, category_id: c.category_id },
        messageId: IDEMPOTENT ? `${c.id}-${r}` : String(c.id),
      });
      sent++;
    }
  }

  await sender.close();

  console.log(`\nSent ${sent} messages to synthesize-queue`);
  if (IDEMPOTENT) {
    console.log("Each cluster_id sent twice — the second should be a no-op (status !== PENDING).");
  }
  console.log("Now run `func start` and watch the story-synthesizer process them.");
  console.log("Then run `node test/verify.js` to check stories table.");
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
}
