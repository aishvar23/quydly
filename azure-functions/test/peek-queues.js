#!/usr/bin/env node
// Peek at Service Bus queues + dead-letter queues.
//
// Usage: node test/peek-queues.js
//
// Shows message counts and peeks at up to 5 messages from each queue + DLQ.

import { sbClient, cleanup } from "./helpers.js";

const QUEUES = ["scrape-queue", "synthesize-queue"];

async function peekQueue(queueName, options = {}) {
  const receiver = sbClient.createReceiver(queueName, {
    receiveMode: "peekLock",
    ...options,
  });

  const messages = await receiver.peekMessages(5);
  await receiver.close();
  return messages;
}

try {
  console.log("\n=== Service Bus Queue Status ===\n");

  for (const queue of QUEUES) {
    console.log(`── ${queue} ──`);

    // Main queue
    const main = await peekQueue(queue);
    console.log(`  Active messages (peeked up to 5): ${main.length}`);
    for (const msg of main) {
      const body = msg.body;
      const id = body?.url_hash || body?.cluster_id || "(unknown)";
      const url = body?.canonical_url ? ` — ${body.canonical_url.slice(0, 60)}` : "";
      console.log(`    [${msg.messageId}] ${id}${url}`);
      console.log(`      deliveryCount=${msg.deliveryCount}  enqueuedTime=${msg.enqueuedTimeUtc?.toISOString()}`);
    }

    // Dead-letter queue
    const dlq = await peekQueue(queue, { subQueueType: "deadLetter" });
    console.log(`  Dead-letter messages (peeked up to 5): ${dlq.length}`);
    for (const msg of dlq) {
      const body = msg.body;
      const id = body?.url_hash || body?.cluster_id || "(unknown)";
      console.log(`    [${msg.messageId}] ${id}`);
      console.log(`      reason=${msg.deadLetterReason}  description=${msg.deadLetterErrorDescription}`);
      console.log(`      deliveryCount=${msg.deliveryCount}  enqueuedTime=${msg.enqueuedTimeUtc?.toISOString()}`);
    }

    console.log();
  }
} catch (err) {
  console.error("Error:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
}
