#!/usr/bin/env node
// Poll synthesis progress — clusters by status + stories written.
//
// Usage:
//   node test/watch-synthesis.js          # poll every 15s until done
//   node test/watch-synthesis.js --once   # print once and exit

import { supabase, cleanup } from "./helpers.js";

const ONCE     = process.argv.includes("--once");
const INTERVAL = 15_000;

async function poll() {
  const now = new Date().toISOString().slice(11, 19); // HH:MM:SS

  const [{ data: clusterRows }, { data: storyRows }, { data: dlqRows }] = await Promise.all([
    supabase
      .from("clusters")
      .select("status")
      .gte("updated_at", new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()),
    supabase
      .from("stories")
      .select("id")
      .gte("published_at", new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()),
    supabase
      .from("clusters")
      .select("id")
      .eq("status", "PROCESSING")
      .lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()), // stuck >5min
  ]);

  const counts = { PENDING: 0, PROCESSING: 0, PROCESSED: 0 };
  for (const row of clusterRows ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const total    = Object.values(counts).reduce((a, b) => a + b, 0);
  const done     = counts.PROCESSED;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  const stories  = (storyRows ?? []).length;
  const stuckCnt = (dlqRows ?? []).length;

  const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));

  console.log(
    `[${now}]  [${bar}] ${pct}%  ` +
    `PENDING=${counts.PENDING}  PROCESSING=${counts.PROCESSING}  PROCESSED=${done}/${total}  ` +
    `stories=${stories}` +
    (stuckCnt > 0 ? `  ⚠ stuck=${stuckCnt}` : "")
  );

  return counts.PENDING === 0 && counts.PROCESSING === 0;
}

try {
  console.log("=== Synthesis progress (Ctrl+C to stop) ===\n");

  const done = await poll();
  if (ONCE || done) process.exit(0);

  const timer = setInterval(async () => {
    try {
      const finished = await poll();
      if (finished) {
        console.log("\nAll clusters processed.");
        clearInterval(timer);
        await cleanup();
        process.exit(0);
      }
    } catch (err) {
      console.error("poll error:", err.message);
    }
  }, INTERVAL);
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
  await cleanup();
  process.exit(1);
}
