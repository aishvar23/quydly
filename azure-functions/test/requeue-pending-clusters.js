#!/usr/bin/env node
// Requeue PENDING clusters to synthesize-queue.
//
// Use this after an Anthropic credit outage to replay clusters that got
// stuck in PROCESSING and were reset back to PENDING in Supabase.
//
// ⚠️  THIS SPENDS REAL MONEY. Each cluster runs the full synthesis chain
// (~4 Anthropic calls, ~$0.035 at current model tiers). On 2026-08-10 an
// uncapped run replayed 193 clusters — 184 of them a 10-day-old backlog —
// and burned ~$9.70, about 75% of that day's total API spend.
//
// Two guards, both deliberate:
//   1. DRY RUN IS THE DEFAULT. Nothing is sent without --execute.
//   2. The selection is CAPPED at --limit (default 25), highest cluster_score
//      first, so a forgotten flag costs at most a cap's worth. Replaying a
//      large backlog is several deliberate runs, not one accident.
//
// Usage:
//   node test/requeue-pending-clusters.js                    # dry run, top 25
//   node test/requeue-pending-clusters.js --limit 50         # dry run, top 50
//   node test/requeue-pending-clusters.js --execute          # SEND top 25
//   node test/requeue-pending-clusters.js --execute --limit 100 --batch 20 --delay 60
//   node test/requeue-pending-clusters.js --execute --limit all   # no cap (asks first)

import { createInterface } from "node:readline/promises";
import { supabase, sbClient, cleanup } from "./helpers.js";

// Per-cluster synthesis cost. Four Anthropic calls: extract-facts-and-quotes
// and audit on the extraction tier, narrative and enrichment on the editorial
// tier (see lib/models.js). Derived from measured per-story token counts —
// ~6.2k in / ~2.1k out. Rounded UP so the preview never understates.
const COST_PER_CLUSTER_USD = 0.035;
const DEFAULT_LIMIT = 25;
// Above this, --execute additionally requires an interactive "yes". A run this
// size is a backlog replay, and backlog replays are what this guard exists for.
const CONFIRM_ABOVE = 50;

function flagValue(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function positiveInt(raw, fallback, name) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return n;
}

// --execute is the ONLY way to send. --dry-run stays accepted so the older
// muscle memory (and `npm run requeue:dry`) keeps working, but it is a no-op
// now that dry run is the default.
const EXECUTE = process.argv.includes("--execute");

const rawLimit = flagValue("--limit");
// `--limit all` is the explicit uncapped escape hatch. It still goes through
// the interactive confirmation below, so "all" is a decision, not a default.
const UNCAPPED = rawLimit === "all";
const LIMIT      = UNCAPPED ? null : positiveInt(rawLimit, DEFAULT_LIMIT, "--limit");
const BATCH_SIZE = positiveInt(flagValue("--batch"), 10, "--batch");
const DELAY_SEC  = positiveInt(flagValue("--delay"), 30, "--delay");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (n) => `$${n.toFixed(2)}`;

async function confirm(question) {
  // No TTY (CI, piped input) → refuse rather than assume consent.
  if (!process.stdin.isTTY) {
    console.error("\nRefusing: this run needs interactive confirmation and stdin is not a TTY.");
    console.error("Re-run with a smaller --limit, or from an interactive shell.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

try {
  console.log(`\n=== Requeue PENDING clusters → synthesize-queue${EXECUTE ? "" : " [DRY RUN]"} ===`);
  console.log(`    limit=${UNCAPPED ? "all (uncapped)" : LIMIT}  batch=${BATCH_SIZE}  delay=${DELAY_SEC}s between batches`);
  if (!EXECUTE) console.log(`    No messages will be sent. Add --execute to send.`);
  console.log("");

  // Count the whole backlog before applying the cap, so the operator can see
  // what they are NOT replaying and decide whether to run again.
  const { count: pendingTotal, error: countErr } = await supabase
    .from("clusters")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING");

  if (countErr) throw new Error(`count clusters: ${countErr.message}`);

  let query = supabase
    .from("clusters")
    .select("id, category_id, cluster_score, updated_at")
    .eq("status", "PENDING")
    .order("cluster_score", { ascending: false }); // highest quality first
  if (!UNCAPPED) query = query.limit(LIMIT);

  const { data: clusters, error } = await query;

  if (error) throw new Error(`fetch clusters: ${error.message}`);

  if (!clusters || clusters.length === 0) {
    console.log("No PENDING clusters found — nothing to requeue.");
    process.exit(0);
  }

  const selected = clusters.length;
  const estCost  = selected * COST_PER_CLUSTER_USD;

  console.log(`${pendingTotal} PENDING clusters in total; selected ${selected} (highest cluster_score first).`);
  if (pendingTotal > selected) {
    console.log(`Leaving ${pendingTotal - selected} unqueued — re-run to take the next ${LIMIT}.`);
  }
  console.log(`\nEstimated Anthropic spend: ~${usd(estCost)}  (${selected} × ${usd(COST_PER_CLUSTER_USD)}/cluster)\n`);

  if (!EXECUTE) {
    for (const c of clusters) {
      console.log(`  id=${c.id}  category=${c.category_id}  score=${c.cluster_score}`);
    }
    console.log(`\n[dry run] No messages sent. Re-run with --execute to spend ~${usd(estCost)}.`);
    process.exit(0);
  }

  if (UNCAPPED || selected > CONFIRM_ABOVE) {
    const ok = await confirm(
      `About to queue ${selected} clusters for ~${usd(estCost)} of Anthropic spend.\nType "yes" to proceed: `,
    );
    if (!ok) {
      console.log("Aborted — nothing sent.");
      process.exit(0);
    }
    console.log("");
  }

  const sender = sbClient.createSender("synthesize-queue");
  let sent = 0;
  const totalBatches = Math.ceil(selected / BATCH_SIZE);

  for (let i = 0; i < selected; i += BATCH_SIZE) {
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

    if (i + BATCH_SIZE < selected) {
      console.log(`  waiting ${DELAY_SEC}s before next batch...`);
      await sleep(DELAY_SEC * 1000);
    }
  }

  await sender.close();
  console.log(`\nDone. Sent ${sent} messages to synthesize-queue (~${usd(sent * COST_PER_CLUSTER_USD)} estimated).`);
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
