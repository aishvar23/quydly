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
// NOTE: card-storage (→ card-renderer → @resvg/resvg-js native binary) is
// imported LAZILY below, only when SOCIAL_CARDS_ENABLED is on. A static import
// here loads the resvg binary at module load; on hosts whose arch lacks a
// matching prebuilt (e.g. Azure Windows win32-ia32) that throws and the whole
// function fails to load. Keeping it lazy means the generator runs everywhere
// when cards are off.

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

  // Headline cards are opt-in (render + storage cost; needs the storage bucket
  // AND a resvg prebuilt for the host arch). When off, cardService stays null,
  // the resvg/satori modules are never imported, and drafts are text-only.
  let cardService = null;
  if (/^(1|true)$/i.test(String(process.env.SOCIAL_CARDS_ENABLED || ""))) {
    const { createCardService } = await import("../lib/social/card-storage.js");
    cardService = createCardService({ supabase, logger: context.log });
  }

  // Instagram carousel (L4): a 4-slide set instead of a single square card.
  // Opt-in and requires cards to be on (the slides ARE cards).
  const igCarousel = /^(1|true)$/i.test(String(process.env.SOCIAL_IG_CAROUSEL_ENABLED || ""));

  // Instagram hashtags (reach §8.3): append a curated hashtag block to IG
  // captions. Opt-in so it can be live-verified before going wide.
  const igHashtags = /^(1|true)$/i.test(String(process.env.SOCIAL_IG_HASHTAGS_ENABLED || ""));

  const { created, skipped } = await generateSocialPosts({
    supabase,
    anthropic,
    cardService,
    igCarousel,
    igHashtags,
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
