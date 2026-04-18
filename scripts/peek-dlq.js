// peek-dlq.js — peek at dead-lettered messages to diagnose failures
// Usage: node scripts/peek-dlq.js
// Requires: AZURE_SERVICE_BUS_CONNECTION_STRING in env (RootManageSharedAccessKey)

import { ServiceBusClient } from "@azure/service-bus";

const QUEUE = "scrape-queue";
const PEEK_COUNT = 10;

async function main() {
  const connStr = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  if (!connStr) {
    console.error("AZURE_SERVICE_BUS_CONNECTION_STRING not set");
    process.exit(1);
  }

  const client = new ServiceBusClient(connStr);
  const receiver = client.createReceiver(QUEUE, {
    subQueueType: "deadLetter",
    receiveMode: "peekLock",
  });

  console.log(`Peeking ${PEEK_COUNT} messages from ${QUEUE}/$deadletterqueue...\n`);

  const messages = await receiver.peekMessages(PEEK_COUNT);

  if (messages.length === 0) {
    console.log("No messages found.");
  }

  for (const msg of messages) {
    console.log("---");
    console.log("URL:              ", msg.body?.url ?? msg.body);
    console.log("DeadLetterReason: ", msg.deadLetterReason);
    console.log("DeadLetterError:  ", msg.deadLetterErrorDescription);
    console.log("DeliveryCount:    ", msg.deliveryCount);
    console.log("EnqueuedAt:       ", msg.enqueuedTimeUtc);
  }

  await receiver.close();
  await client.close();
}

main().catch(console.error);
