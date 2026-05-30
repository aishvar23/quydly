#!/usr/bin/env node
// Live driver for the social post generator via the real Service Bus path.
//
//   1. Re-enqueue a generation message for every candidate still PENDING.
//   2. Drain social-post-generate-queue (peek-lock): generate drafts, complete.
//   3. Purge any dead-letter messages on the queue (stale from earlier runs).
//
// Generation is idempotent (UNIQUE story_id+platform+audience_geo), so re-drives
// only skip existing posts and advance the candidate to POST_GENERATED.
//
// Usage: node test/run-social-post-generator.js

import { supabase, sbClient, cleanup, fakeContext } from "./helpers.js";
import { getAnthropic } from "../lib/clients.js";
import { generateSocialPosts } from "../lib/social/social-post-generator.js";

const QUEUE = "social-post-generate-queue";
const ctx = fakeContext("social-post-generator");
const anthropic = getAnthropic();

try {
  // 1. Re-enqueue PENDING candidates.
  const { data: pending, error } = await supabase
    .from("social_publication_candidates")
    .select("id")
    .eq("status", "PENDING");
  if (error) throw error;

  if (pending.length) {
    const sender = sbClient.createSender(QUEUE);
    await sender.sendMessages(pending.map((c) => ({ body: { candidate_id: c.id }, messageId: c.id })));
    await sender.close();
    console.log(`Enqueued ${pending.length} candidate(s).`);
  } else {
    console.log("No PENDING candidates to enqueue.");
  }

  // 2. Drain the main queue.
  const receiver = sbClient.createReceiver(QUEUE, { receiveMode: "peekLock" });
  let processed = 0, created = 0, skipped = 0;
  while (true) {
    const batch = await receiver.receiveMessages(5, { maxWaitTimeInMs: 5000 });
    if (batch.length === 0) break;
    for (const msg of batch) {
      const candidateId = msg.body?.candidate_id;
      try {
        const r = await generateSocialPosts({ supabase, anthropic, candidateId, logger: ctx.log });
        created += r.created; skipped += r.skipped;
        await receiver.completeMessage(msg);
        processed++;
        console.log(`  ✓ ${candidateId}: +${r.created} created, ${r.skipped} skipped`);
      } catch (err) {
        await receiver.abandonMessage(msg);
        console.error(`  ✗ ${candidateId}: ${err.message}`);
      }
    }
  }
  await receiver.close();
  console.log(`\nDrained ${processed} message(s) — ${created} created, ${skipped} skipped.`);

  // 3. Purge stale dead-letter messages on this queue.
  const dlq = sbClient.createReceiver(QUEUE, { subQueueType: "deadLetter", receiveMode: "receiveAndDelete" });
  let purged = 0;
  while (true) {
    const dead = await dlq.receiveMessages(50, { maxWaitTimeInMs: 5000 });
    if (dead.length === 0) break;
    purged += dead.length;
  }
  await dlq.close();
  console.log(`Purged ${purged} dead-letter message(s).`);
} catch (err) {
  console.error("FAILED:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  process.exit(process.exitCode || 0);
}
