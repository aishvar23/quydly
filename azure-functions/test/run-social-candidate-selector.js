#!/usr/bin/env node
// Live invocation of the social-candidate-selector timer function.
// Creates real social_publication_candidates rows and enqueues generation jobs.
//
// Usage: node test/run-social-candidate-selector.js

import "./helpers.js"; // loads env from local.settings.json into process.env
import { fakeContext, cleanup } from "./helpers.js";
import selector from "../social-candidate-selector/index.js";

try {
  console.log("\n=== Running social-candidate-selector (LIVE) ===\n");
  await selector(fakeContext("social-candidate-selector"), { isPastDue: false });
  console.log("\nDone.");
} catch (err) {
  console.error("FAILED:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  // lib/clients.js keeps a lazy ServiceBus client open (reused by the Functions
  // runtime); in a one-off runner it pins the event loop, so force exit.
  process.exit(process.exitCode || 0);
}
