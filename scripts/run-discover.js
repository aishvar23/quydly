// Local smoke-test runner for Phase 4.4
// Usage: node --env-file=.env scripts/run-discover.js

import { runDiscovery } from "../backend/services/discoverer.js";

console.log("Starting discovery run...\n");
const summary = await runDiscovery();
console.log("\nSummary:", summary);
