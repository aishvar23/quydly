#!/usr/bin/env node
/**
 * peek-dlq.js — Inspect dead-letter messages from both Service Bus DLQs.
 * Does NOT remove messages — safe to run at any time.
 *
 * Usage:
 *   node azure-functions/scripts/peek-dlq.js
 *
 * Requires: AZURE_SERVICE_BUS_CONNECTION_STRING (RootManageSharedAccessKey)
 *   in azure-functions/local.settings.json or process env.
 */

import { ServiceBusClient } from "@azure/service-bus";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const settings = JSON.parse(readFileSync(join(__dirname, "../local.settings.json"), "utf8"));
  for (const [k, v] of Object.entries(settings.Values ?? {})) {
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* rely on process.env */ }

const CONNECTION_STRING = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
if (!CONNECTION_STRING) {
  console.error("ERROR: AZURE_SERVICE_BUS_CONNECTION_STRING not set.");
  process.exit(1);
}

const QUEUES   = ["scrape-queue", "synthesize-queue"];
const MAX_PEEK = 20;

async function peekQueue(client, queueName) {
  const dlqName  = `${queueName}/$deadletterqueue`;
  const receiver = client.createReceiver(dlqName, { receiveMode: "peekLock" });

  console.log(`\n── ${queueName} DLQ ──────────────────────────────────`);

  try {
    const msgs = await receiver.peekMessages(MAX_PEEK);
    if (msgs.length === 0) {
      console.log("  (empty)");
      return;
    }

    for (const msg of msgs) {
      console.log(`  messageId : ${msg.messageId ?? "—"}`);
      console.log(`  reason    : ${msg.deadLetterReason ?? "—"}`);
      console.log(`  error     : ${msg.deadLetterErrorDescription ?? "—"}`);
      console.log(`  body      : ${JSON.stringify(msg.body)}`);
      console.log(`  enqueued  : ${msg.enqueuedTimeUtc?.toISOString() ?? "—"}`);
      console.log(`  deliveries: ${msg.deliveryCount ?? "—"}`);
      console.log("  ─────────────────────────────────────────────────");
    }
    console.log(`  Total shown: ${msgs.length}${msgs.length === MAX_PEEK ? ` (capped at ${MAX_PEEK})` : ""}`);
  } finally {
    await receiver.close();
  }
}

async function main() {
  console.log(`\nPeeking DLQ messages — ${new Date().toUTCString()}`);
  const client = new ServiceBusClient(CONNECTION_STRING);

  try {
    for (const q of QUEUES) {
      await peekQueue(client, q);
    }
  } finally {
    await client.close();
  }

  console.log("\nDone. No messages were removed.\n");
}

main().catch(err => { console.error(err); process.exit(1); });
