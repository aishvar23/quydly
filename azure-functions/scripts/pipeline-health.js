#!/usr/bin/env node
/**
 * pipeline-health.js — Quydly pipeline status snapshot
 *
 * Usage:
 *   node azure-functions/scripts/pipeline-health.js
 *
 * Requires env vars (or azure-functions/.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   AZURE_SERVICE_BUS_CONNECTION_STRING  (for DLQ counts via az CLI)
 */

import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getRawArticles, getClusters, getStories } from "../../backend/services/pipelineHealth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const settings = JSON.parse(readFileSync(join(__dirname, "../local.settings.json"), "utf8"));
  for (const [k, v] of Object.entries(settings.Values ?? {})) {
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* rely on process.env */ }

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── DLQ via Azure CLI (local only) ───────────────────────────────────────────

function azCliInt(cmd) {
  try {
    return parseInt(execSync(cmd, { stdio: ["pipe", "pipe", "pipe"] }).toString().trim(), 10);
  } catch {
    return null;
  }
}

function dlqCounts() {
  const rg      = "quydly-pipeline-rg";
  const ns      = "quydly-pipeline";
  const baseCmd = `az servicebus queue show --resource-group ${rg} --namespace-name ${ns}`;

  const scrapeActive = azCliInt(`${baseCmd} --name scrape-queue     --query "countDetails.activeMessageCount"    -o tsv`);
  const scrapeDlq    = azCliInt(`${baseCmd} --name scrape-queue     --query "countDetails.deadLetterMessageCount" -o tsv`);
  const synthActive  = azCliInt(`${baseCmd} --name synthesize-queue --query "countDetails.activeMessageCount"    -o tsv`);
  const synthDlq     = azCliInt(`${baseCmd} --name synthesize-queue --query "countDetails.deadLetterMessageCount" -o tsv`);

  return { scrapeActive, scrapeDlq, synthActive, synthDlq };
}

// ── Terminal renderer ─────────────────────────────────────────────────────────

function section(title) {
  console.log(`\n${"─".repeat(52)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(52));
}

function row(label, value, flag = "") {
  const pad = 32;
  console.log(`  ${label.padEnd(pad)} ${String(value).padStart(10)}  ${flag}`);
}

async function main() {
  console.log(`\nQuydly Pipeline Health — ${new Date().toUTCString()}`);

  const [art, clust, stor, dlq] = await Promise.all([
    getRawArticles(supabase),
    getClusters(supabase),
    getStories(supabase),
    Promise.resolve(dlqCounts()),
  ]);

  section("raw_articles");
  row("Total", art.total);
  row("  DONE",        art.done);
  row("  LOW_QUALITY", art.lowQuality);
  row("  PARTIAL",     art.partial);
  row("  FAILED",      art.failed);
  row("Unclustered backlog (DONE)", art.unclustered,
    art.unclustered > 0 ? "⚠️  run article-clusterer" : "✅");

  section("clusters");
  row("Total", clust.total);
  row("  PROCESSED",  clust.processed);
  row("  PENDING",    clust.pending);
  row("Not yet queued for synthesis", clust.notQueued);
  row("Stuck PROCESSING", clust.stuckProcessing,
    clust.stuckProcessing > 0 ? "⚠️  reset to PENDING" : "✅");

  section("stories");
  row("Total",    stor.total);
  row("Last 24h", stor.last24h, stor.last24h === 0 ? "⚠️  pipeline may be stalled" : "✅");
  row("Last 7d",  stor.last7d);
  console.log("\n  Recent days:");
  for (const [day, count] of stor.recentDays) {
    row(`    ${day}`, count);
  }

  section("Service Bus queues");
  if (dlq.scrapeActive === null) {
    console.log("  ⚠️  az CLI not available — install Azure CLI to see queue counts");
  } else {
    row("scrape-queue   active",   dlq.scrapeActive);
    row("scrape-queue   DLQ",      dlq.scrapeDlq,  dlq.scrapeDlq  > 0 ? "⚠️  check dead letters" : "✅");
    row("synthesize-queue active", dlq.synthActive);
    row("synthesize-queue DLQ",    dlq.synthDlq,   dlq.synthDlq   > 0 ? "⚠️  check dead letters" : "✅");
  }

  section("Summary");
  const issues = [
    art.unclustered > 0         && `Clustering backlog: ${art.unclustered} articles`,
    clust.stuckProcessing > 0   && `${clust.stuckProcessing} clusters stuck in PROCESSING`,
    stor.last24h === 0          && "No stories in the last 24h",
    dlq.scrapeDlq  > 0         && `scrape-queue DLQ: ${dlq.scrapeDlq} messages`,
    dlq.synthDlq   > 0         && `synthesize-queue DLQ: ${dlq.synthDlq} messages`,
  ].filter(Boolean);

  if (issues.length === 0) {
    console.log("  ✅  All systems healthy");
  } else {
    console.log("  Issues detected:");
    for (const issue of issues) console.log(`    ⚠️  ${issue}`);
  }

  console.log("");
}

main().catch(err => { console.error(err); process.exit(1); });
