// purge-dlq.js — drain and discard all messages from scrape-queue DLQ
// Usage: node azure-functions/purge-dlq.js
// Requires: AZURE_SERVICE_BUS_CONNECTION_STRING (RootManageSharedAccessKey)

import { ServiceBusClient } from "@azure/service-bus";

const QUEUE = "scrape-queue";
const BATCH_SIZE = 50;

async function main() {
  const connStr = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  if (!connStr) {
    console.error("AZURE_SERVICE_BUS_CONNECTION_STRING not set");
    process.exit(1);
  }

  const client = new ServiceBusClient(connStr);
  const receiver = client.createReceiver(QUEUE, {
    subQueueType: "deadLetter",
    receiveMode: "receiveAndDelete", // no need to complete manually
  });

  let total = 0;
  console.log(`Purging ${QUEUE}/$deadletterqueue...`);

  while (true) {
    const messages = await receiver.receiveMessages(BATCH_SIZE, { maxWaitTimeInMs: 5000 });
    if (messages.length === 0) break;
    total += messages.length;
    console.log(`  Purged ${total} so far...`);
  }

  await receiver.close();
  await client.close();
  console.log(`Done. Total purged: ${total}`);
}

main().catch(console.error);
