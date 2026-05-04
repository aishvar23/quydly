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

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load from local.settings.json (Azure Functions local dev config)
try {
  const settings = JSON.parse(readFileSync(join(__dirname, "../local.settings.json"), "utf8"));
  for (const [k, v] of Object.entries(settings.Values ?? {})) {
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* not present — rely on process.env */ }

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function section(title) {
  console.log(`\n${"─".repeat(52)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(52));
}

function row(label, value, flag = "") {
  const pad = 32;
  console.log(`  ${label.padEnd(pad)} ${String(value).padStart(10)}  ${flag}`);
}

function azCliInt(cmd) {
  try {
    return parseInt(execSync(cmd, { stdio: ["pipe", "pipe", "pipe"] }).toString().trim(), 10);
  } catch {
    return null;
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function countWhere(table, filters = {}) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) {
    if (v === null) q = q.is(k, null);
    else            q = q.eq(k, v);
  }
  const { count } = await q;
  return count ?? 0;
}

async function rawArticles() {
  const [done, lowQuality, failed, partial, unclustered] = await Promise.all([
    countWhere("raw_articles", { status: "DONE" }),
    countWhere("raw_articles", { status: "LOW_QUALITY" }),
    countWhere("raw_articles", { status: "FAILED" }),
    countWhere("raw_articles", { status: "PARTIAL" }),
    supabase
      .from("raw_articles")
      .select("*", { count: "exact", head: true })
      .eq("status", "DONE")
      .is("clustered_at", null)
      .then(r => r.count ?? 0),
  ]);

  const counts = {};
  if (done)       counts["DONE"]        = done;
  if (lowQuality) counts["LOW_QUALITY"] = lowQuality;
  if (failed)     counts["FAILED"]      = failed;
  if (partial)    counts["PARTIAL"]     = partial;

  const total = done + lowQuality + failed + partial;
  return { total, counts, unclustered };
}

async function clusters() {
  const [processed, pending, processing] = await Promise.all([
    countWhere("clusters", { status: "PROCESSED" }),
    countWhere("clusters", { status: "PENDING" }),
    countWhere("clusters", { status: "PROCESSING" }),
  ]);

  const notQueuedForSynthesis = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true })
    .eq("status", "PENDING")
    .is("synthesis_queued_at", null)
    .then(r => r.count ?? 0);

  const counts = {};
  if (processed) counts["PROCESSED"]  = processed;
  if (pending)   counts["PENDING"]    = pending;
  if (processing) counts["PROCESSING"] = processing;

  const total = processed + pending + processing;
  return { total, counts, notQueuedForSynthesis, stuckProcessing: processing };
}

async function stories() {
  const now   = new Date();
  const ago   = (days) => new Date(now - days * 86400 * 1000).toISOString();

  const [total, last24h, last7d, last14d, recentRows] = await Promise.all([
    supabase.from("stories").select("*", { count: "exact", head: true }).then(r => r.count ?? 0),
    supabase.from("stories").select("*", { count: "exact", head: true }).gte("published_at", ago(1)).then(r => r.count ?? 0),
    supabase.from("stories").select("*", { count: "exact", head: true }).gte("published_at", ago(7)).then(r => r.count ?? 0),
    supabase.from("stories").select("*", { count: "exact", head: true }).gte("published_at", ago(14)).then(r => r.count ?? 0),
    supabase.from("stories").select("published_at").gte("published_at", ago(7)).order("published_at", { ascending: false }),
  ]);

  const byDay = {};
  for (const s of recentRows.data ?? []) {
    const day = s.published_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  const recentDays = Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a));

  return { total, last24h, last7d, last14d, recentDays };
}

function dlqCounts() {
  const rg        = "quydly-pipeline-rg";
  const ns        = "quydly-pipeline";
  const baseCmd   = `az servicebus queue show --resource-group ${rg} --namespace-name ${ns}`;

  const scrapeActive  = azCliInt(`${baseCmd} --name scrape-queue     --query "countDetails.activeMessageCount"    -o tsv`);
  const scrapeDlq     = azCliInt(`${baseCmd} --name scrape-queue     --query "countDetails.deadLetterMessageCount" -o tsv`);
  const synthActive   = azCliInt(`${baseCmd} --name synthesize-queue --query "countDetails.activeMessageCount"    -o tsv`);
  const synthDlq      = azCliInt(`${baseCmd} --name synthesize-queue --query "countDetails.deadLetterMessageCount" -o tsv`);

  return { scrapeActive, scrapeDlq, synthActive, synthDlq };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nQuydly Pipeline Health — ${new Date().toUTCString()}`);

  const [art, clust, stor, dlq] = await Promise.all([
    rawArticles(),
    clusters(),
    stories(),
    Promise.resolve(dlqCounts()),
  ]);

  // ── raw_articles ────────────────────────────────────────────────────────────
  section("raw_articles");
  row("Total", art.total);
  for (const [status, count] of Object.entries(art.counts)) {
    row(`  ${status}`, count);
  }
  row("Unclustered backlog (DONE)", art.unclustered,
    art.unclustered > 0 ? "⚠️  run article-clusterer" : "✅");

  // ── clusters ────────────────────────────────────────────────────────────────
  section("clusters");
  row("Total", clust.total);
  for (const [status, count] of Object.entries(clust.counts)) {
    row(`  ${status}`, count);
  }
  row("Not yet queued for synthesis", clust.notQueuedForSynthesis);
  row("Stuck PROCESSING", clust.stuckProcessing,
    clust.stuckProcessing > 0 ? "⚠️  reset to PENDING" : "✅");

  // ── stories ─────────────────────────────────────────────────────────────────
  section("stories");
  row("Total", stor.total);
  row("Last 24h", stor.last24h,  stor.last24h  === 0 ? "⚠️  pipeline may be stalled" : "✅");
  row("Last 7d",  stor.last7d);
  row("Last 14d", stor.last14d);
  console.log("\n  Recent days:");
  for (const [day, count] of stor.recentDays) {
    row(`    ${day}`, count);
  }

  // ── Service Bus / DLQ ───────────────────────────────────────────────────────
  section("Service Bus queues");
  if (dlq.scrapeActive === null) {
    console.log("  ⚠️  az CLI not available — install Azure CLI to see queue counts");
  } else {
    row("scrape-queue   active",      dlq.scrapeActive);
    row("scrape-queue   DLQ",         dlq.scrapeDlq,   dlq.scrapeDlq   > 0 ? "⚠️  check dead letters" : "✅");
    row("synthesize-queue active",    dlq.synthActive);
    row("synthesize-queue DLQ",       dlq.synthDlq,    dlq.synthDlq    > 0 ? "⚠️  check dead letters" : "✅");
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  section("Summary");
  const issues = [
    art.unclustered > 0            && `Clustering backlog: ${art.unclustered} articles`,
    clust.stuckProcessing > 0      && `${clust.stuckProcessing} clusters stuck in PROCESSING`,
    stor.last24h === 0             && "No stories in the last 24h",
    dlq.scrapeDlq   > 0           && `scrape-queue DLQ: ${dlq.scrapeDlq} messages`,
    dlq.synthDlq    > 0           && `synthesize-queue DLQ: ${dlq.synthDlq} messages`,
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
