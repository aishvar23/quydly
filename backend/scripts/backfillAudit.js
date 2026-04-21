// One-time backfill: audit all existing stories that haven't been audited yet.
// Run after migration_quality_audit.sql:
//   node backend/scripts/backfillAudit.js
//
// Processes stories in batches; safe to interrupt and re-run (skips audited_at IS NOT NULL).

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import { createClient } from "@supabase/supabase-js";
import { auditStory, persistAudit } from "../../azure-functions/lib/storyAudit.js";

const BATCH_SIZE    = 10;
const DELAY_MS      = 500; // pause between batches to avoid rate limits
const MIN_CONFIDENCE = 6;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchBatch(afterId) {
  const { data, error } = await supabase
    .from("stories")
    .select("id, headline, summary, key_points, confidence_score, source_count")
    .gte("confidence_score", MIN_CONFIDENCE)
    .is("audited_at", null)
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) throw new Error(`fetch batch: ${error.message}`);
  return data ?? [];
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log("[backfillAudit] starting...");

  let afterId  = 0;
  let total    = 0;
  let approved = 0;
  let rejected = 0;
  let errors   = 0;

  while (true) {
    const batch = await fetchBatch(afterId);
    if (batch.length === 0) break;

    total += batch.length;
    console.log(`[backfillAudit] processing ${batch.length} stories (ids ${batch[0].id}–${batch[batch.length - 1].id})`);

    for (const story of batch) {
      try {
        // Backfill mode: extracted facts were not stored for pre-existing stories.
        // support_score is graded on internal consistency only and its threshold
        // is not enforced, matching the intent of the live-synthesis audit path.
        const auditResult = await auditStory(
          {
            headline:         story.headline,
            summary:          story.summary,
            key_points:       story.key_points ?? [],
            confidence_score: story.confidence_score,
            source_count:     story.source_count,
          },
          [],
          { backfillMode: true },
        );

        await persistAudit(supabase, story.id, auditResult);

        const status = auditResult.quiz_candidate ? "APPROVED" : "REJECTED";
        console.log(
          `  story ${story.id}: ${status} ` +
          `[spec=${auditResult.specificity_score.toFixed(2)} ` +
          `coh=${auditResult.coherence_score.toFixed(2)} ` +
          `sup=${auditResult.support_score.toFixed(2)} ` +
          `quiz=${auditResult.quizability_score.toFixed(2)}] ` +
          `flags=${auditResult.quality_flags.join(",") || "none"} — ${auditResult.reason}`,
        );

        if (auditResult.quiz_candidate) approved++;
        else rejected++;
      } catch (err) {
        console.error(`  story ${story.id}: ERROR — ${err.message}`);
        errors++;
      }
    }

    afterId = batch[batch.length - 1].id;
    if (batch.length === BATCH_SIZE) await sleep(DELAY_MS);
  }

  console.log(
    `[backfillAudit] done — ${approved} approved, ${rejected} rejected, ${errors} errors`,
  );
}

run().catch(err => {
  console.error("[backfillAudit] fatal:", err);
  process.exit(1);
});
