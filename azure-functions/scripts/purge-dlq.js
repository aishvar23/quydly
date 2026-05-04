#!/usr/bin/env node
/**
 * purge-dlq.js — Discard all dead-letter messages from both Service Bus DLQs.
 *
 * Use when failures were due to infrastructure issues (credits lapsed, Redis down,
 * Supabase timeout, domain blocking) and messages are stale / not worth retrying.
 *
 * Usage:
 *   node azure-functions/scripts/purge-dlq.js
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

const QUEUES = ["scrape-queue", "synthesize-queue"];
const BATCH  = 100;

async function purgeQueue(client, queueName) {
  const dlqName  = `${queueName}/$deadletterqueue`;
  const receiver = client.createReceiver(dlqName, { receiveMode: "receiveAndDelete" });

  let total = 0;
  process.stdout.write(`  ${queueName} DLQ ... `);

  try {
    while (true) {
      const msgs = await receiver.receiveMessages(BATCH, { maxWaitTimeInMs: 3000 });
      if (msgs.length === 0) break;
      total += msgs.length;
      process.stdout.write(`${total} `);
    }
  } finally {
    await receiver.close();
  }

  console.log(`\n  -> purged ${total} messages`);
  return total;
}

async function main() {
  console.log(`\nPurging DLQ messages — ${new Date().toUTCString()}\n`);
  const client = new ServiceBusClient(CONNECTION_STRING);

  let grand = 0;
  try {
    for (const q of QUEUES) {
      grand += await purgeQueue(client, q);
    }
  } finally {
    await client.close();
  }

  console.log(`\nDone. Total purged: ${grand} messages.`);
}

main().catch(err => { console.error(err); process.exit(1); });
