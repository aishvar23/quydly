// Azure Service Bus Function: social-post-generator
// Trigger: social-post-generate-queue message — { candidate_id }
//
// Generates one PENDING_REVIEW draft per platform (x / facebook / instagram)
// for the candidate, then advances the candidate to POST_GENERATED.
//
// autoComplete: true (host.json) — return normally = complete, throw = abandon
// (retried up to maxDeliveryCount=3). Generation is idempotent on
// UNIQUE(story_id, platform, audience_geo), so retries never duplicate posts.

import { getSupabase, getAnthropic } from "../lib/clients.js";
import { generateSocialPosts } from "../lib/social/social-post-generator.js";
import { createCardService } from "../lib/social/card-storage.js";

export default async function socialPostGenerator(context, message) {
  const candidateId = message && (message.candidate_id || message.candidateId);

  if (!candidateId) {
    // Bad message shape — log and complete (throwing would just retry the same
    // poison message until it dead-letters).
    context.log.error(JSON.stringify({ event: "social_generate_bad_message", message }));
    return;
  }

  const supabase = getSupabase();
  const anthropic = getAnthropic(); // null when ANTHROPIC_API_KEY is unset → deterministic

  // Headline cards are opt-in (render + storage cost; needs the storage bucket).
  // When off, cardService stays null and drafts are text-only, as before.
  const cardService = /^(1|true)$/i.test(String(process.env.SOCIAL_CARDS_ENABLED || ""))
    ? createCardService({ supabase, logger: context.log })
    : null;

  const { created, skipped } = await generateSocialPosts({
    supabase,
    anthropic,
    cardService,
    candidateId,
    logger: context.log,
  });

  context.log(JSON.stringify({
    event: "social_generate_complete",
    candidate_id: candidateId,
    posts_created: created,
    posts_skipped: skipped,
    used_llm: !!anthropic,
  }));
}
