// replay-dlq.js — move dead-lettered messages back to scrape-queue for reprocessing
// Usage: node azure-functions/replay-dlq.js
// Requires: AZURE_SERVICE_BUS_CONNECTION_STRING (RootManageSharedAccessKey)
//
// When to use:
//   - A transient infra issue (Redis down, Supabase timeout) caused bulk failures
//   - The underlying bug has been fixed and messages are worth retrying
//   - Do NOT replay if failures were due to bad URLs or blocked domains (use purge-dlq.js instead)

import { ServiceBusClient } from "@azure/service-bus";

const QUEUE      = "scrape-queue";
const BATCH_SIZE = 50;

async function main() {
  const connStr = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  if (!connStr) {
    console.error("AZURE_SERVICE_BUS_CONNECTION_STRING not set");
    process.exit(1);
  }

  const client   = new ServiceBusClient(connStr);
  const receiver = client.createReceiver(QUEUE, {
    subQueueType: "deadLetter",
    receiveMode:  "peekLock",
  });
  const sender = client.createSender(QUEUE);

  let total = 0;
  console.log(`Replaying ${QUEUE}/$deadletterqueue → ${QUEUE}...`);

  while (true) {
    const messages = await receiver.receiveMessages(BATCH_SIZE, { maxWaitTimeInMs: 5000 });
    if (messages.length === 0) break;

    for (const msg of messages) {
      await sender.sendMessages({ body: msg.body, messageId: msg.messageId });
      await receiver.completeMessage(msg);
      total++;
    }
    console.log(`  Replayed ${total} so far...`);
  }

  await receiver.close();
  await sender.close();
  await client.close();
  console.log(`Done. Total replayed: ${total}`);
}

main().catch(console.error);
