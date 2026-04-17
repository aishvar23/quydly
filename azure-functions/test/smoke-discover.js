#!/usr/bin/env node
// Smoke test 4.6 — Trigger discover function directly, verify SB messages + DB rows.
//
// Usage: node test/smoke-discover.js
//
// What it does:
//   1. Calls the discover handler with a fake timer context
//   2. Peeks at scrape-queue to confirm messages were sent
//   3. Checks scrape_queue table for new PENDING rows
//
// Prerequisites: local.settings.json has real credentials

import discover from "../discover/index.js";
import { supabase, sbClient, fakeContext, cleanup } from "./helpers.js";

const ctx = fakeContext("smoke-discover");

try {
  console.log("\n=== Phase 4.6: Discover Smoke Test ===\n");

  // Count scrape_queue rows before
  const { count: beforeCount } = await supabase
    .from("scrape_queue")
    .select("*", { count: "exact", head: true });

  console.log(`scrape_queue rows before: ${beforeCount}`);

  // Run discover
  console.log("Running discover function...");
  const start = Date.now();
  await discover(ctx, { isPastDue: false });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Discover completed in ${elapsed}s`);

  // Count scrape_queue rows after
  const { count: afterCount } = await supabase
    .from("scrape_queue")
    .select("*", { count: "exact", head: true });

  const newRows = afterCount - beforeCount;
  console.log(`scrape_queue rows after: ${afterCount} (+${newRows} new)`);

  // Peek at Service Bus queue
  const receiver = sbClient.createReceiver("scrape-queue", { receiveMode: "peekLock" });
  const peeked = await receiver.peekMessages(5);
  console.log(`\nPeeked ${peeked.length} messages from scrape-queue:`);
  for (const msg of peeked) {
    console.log(`  - ${msg.body?.canonical_url ?? "(no url)"}`);
  }
  await receiver.close();

  // Summary
  console.log("\n--- Result ---");
  if (newRows > 0) {
    console.log(`PASS: ${newRows} new URLs discovered and queued`);
  } else {
    console.log("WARN: 0 new URLs — may be expected if feeds were recently scraped");
  }
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
}
