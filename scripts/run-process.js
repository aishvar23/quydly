// Local smoke-test runner for Phase 5.5
// Usage: node --env-file=.env scripts/run-process.js

import { runProcessing } from "../backend/services/processor.js";

console.log("Starting processing run...\n");
const summary = await runProcessing();
console.log("\nSummary:", summary);
