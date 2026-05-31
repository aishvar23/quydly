// Azure Timer Function: social-candidate-selector
// Trigger: hourly — "0 */60 * * * *"
//
// Selects high-quality, fresh synthesized stories that are eligible for social
// distribution and creates one social_publication_candidate per (story, geo).
// For each newly created candidate, enqueues a generation job to
// social-post-generate-queue (consumed by social-post-generator in Phase 2).
//
// Phase 1 guarantees (design §7.1):
//   - No post text is generated here.
//   - No external social API calls.
//   - Idempotent: UNIQUE(story_id, audience_geo) means re-runs never duplicate.
//   - Per-geo daily cap (FLAGS.social.maxCandidatesPerDayPerGeo).

import { getSupabase, getSbSender } from "../lib/clients.js";
import { selectEligibleStories, insertCandidate, decideCandidateStatus } from "../lib/social/social-candidates.js";
import FLAGS from "../lib/flags.js";

export default async function socialCandidateSelector(context, timer) {
  if (timer.isPastDue) {
    context.log("Timer is past due — running now.");
  }

  const supabase = getSupabase();
  const social = FLAGS.social;

  const pairs = await selectEligibleStories(supabase, { now: new Date(), flags: social });

  if (pairs.length === 0) {
    context.log(JSON.stringify({ event: "social_candidates_none" }));
    return;
  }

  // Auto-publish (UNGATED — owner decision 2026-05-31). OFF unless
  // SOCIAL_AUTO_PUBLISH_ENABLED=true. When on, every candidate is AUTO_APPROVED
  // regardless of sensitivity/category/quality (see decideCandidateStatus).
  // The only remaining limiter is a per-day ceiling — purely to avoid X's
  // anti-spam suspension, NOT a content filter. Tune via SOCIAL_MAX_AUTO_PER_DAY
  // (env) without a redeploy; falls back to FLAGS.social.autoApprove.maxPerDay.
  const autoEnabled = process.env.SOCIAL_AUTO_PUBLISH_ENABLED === "true";
  const maxAutoPerDay = Number(process.env.SOCIAL_MAX_AUTO_PER_DAY) || social.autoApprove.maxPerDay;
  let autoRemaining = 0;
  if (autoEnabled) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("social_publication_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "AUTO_APPROVED")
      .gte("selected_at", startOfDay.toISOString());
    autoRemaining = Math.max(0, maxAutoPerDay - (count || 0));
  }

  let candidates_created = 0;
  let candidates_skipped = 0; // already existed (idempotent)
  let candidates_auto_approved = 0;
  let messages_enqueued = 0;
  let enqueue_failures = 0;

  const sender = getSbSender(social.generateQueue);

  try {
    for (const pair of pairs) {
      const status = decideCandidateStatus(pair.story, {
        autoEnabled,
        autoFlags: social.autoApprove,
        autoRemaining,
      });

      const candidate = await insertCandidate(supabase, pair, { status });

      if (!candidate) {
        candidates_skipped++;
        continue;
      }
      candidates_created++;
      if (candidate.status === "AUTO_APPROVED") {
        candidates_auto_approved++;
        autoRemaining--;
      }

      // Enqueue generation. A send failure must not lose the candidate — the
      // generator can be re-driven; we just log and continue.
      try {
        await sender.sendMessages({
          body: { candidate_id: candidate.id },
          messageId: candidate.id,
        });
        messages_enqueued++;
        context.log(JSON.stringify({
          event: "social_candidate_enqueued",
          candidate_id: candidate.id,
          story_id: pair.story.id,
          audience_geo: pair.audienceGeo,
        }));
      } catch (sbErr) {
        enqueue_failures++;
        context.log.error(JSON.stringify({
          event: "social_enqueue_error",
          candidate_id: candidate.id,
          error: sbErr.message,
        }));
      }
    }
  } finally {
    await sender.close();
  }

  context.log(JSON.stringify({
    event: "social_candidates_complete",
    candidates_created,
    candidates_auto_approved,
    candidates_skipped,
    messages_enqueued,
    enqueue_failures,
    auto_publish_enabled: autoEnabled,
  }));
}
