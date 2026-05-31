// Social post generator orchestrator. Design §7.2.
//
// generateSocialPosts({ supabase, anthropic, candidateId, logger }) loads a
// candidate + its story and produces one PENDING_REVIEW draft per platform
// (x / facebook / instagram), idempotent on UNIQUE(story_id, platform,
// audience_geo). When an Anthropic client is provided it generates native copy
// and validates it (§10.4); on any failure it falls back to the deterministic
// formatter, which is built only from story facts and cannot hallucinate.
//
// No external social API calls happen here — drafts are review-first.

import * as x from "./platforms/x.js";
import * as facebook from "./platforms/facebook.js";
import * as instagram from "./platforms/instagram.js";
import { validatePost } from "./social-validation.js";

const PLATFORMS = [x, facebook, instagram];
const MODEL = "claude-sonnet-4-20250514";

const STORY_COLUMNS =
  "id, headline, summary, category_id, key_points, source_count, story_score, confidence_score";

// Callable logger matching the Azure Functions `context.log` convention
// (a function with .warn / .error attached), so handlers can pass context.log directly.
const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

// Ask Claude for native copy. Returns the post text, or throws on any problem.
async function generateWithClaude(anthropic, platform, story, audienceGeo) {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: platform.buildPrompt(story, audienceGeo) }],
  });

  let raw = String(msg?.content?.[0]?.text || "").trim();
  raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  const parsed = JSON.parse(raw);
  const text = parsed && parsed.post_text;
  if (!text || typeof text !== "string") {
    throw new Error("Claude response missing post_text");
  }
  return text.trim();
}

// Build one platform draft. Deterministic by default; LLM copy only when it
// passes validation.
export async function generatePlatformPost({ platform, story, audienceGeo, anthropic, logger = noopLogger }) {
  const draft = platform.format(story, audienceGeo); // deterministic base

  if (anthropic) {
    try {
      const llmText = await generateWithClaude(anthropic, platform, story, audienceGeo);
      const { valid, errors } = validatePost({
        platform: platform.PLATFORM,
        text: llmText,
        story,
        constraints: platform.CONSTRAINTS,
      });
      if (valid) {
        return { ...draft, text: llmText };
      }
      logger.warn(JSON.stringify({
        event: "social_llm_validation_failed",
        platform: platform.PLATFORM,
        story_id: story.id,
        errors,
      }));
    } catch (err) {
      logger.warn(JSON.stringify({
        event: "social_llm_generation_failed",
        platform: platform.PLATFORM,
        story_id: story.id,
        error: err.message,
      }));
    }
  }

  return draft; // deterministic fallback
}

export async function generateSocialPosts({ supabase, anthropic = null, candidateId, logger = noopLogger }) {
  const { data: candidate, error: candErr } = await supabase
    .from("social_publication_candidates")
    .select("id, story_id, audience_geo, status")
    .eq("id", candidateId)
    .maybeSingle();

  if (candErr) throw new Error(`[social-post-generator] fetch candidate: ${candErr.message}`);
  if (!candidate) throw new Error(`[social-post-generator] candidate not found: ${candidateId}`);

  const { data: story, error: storyErr } = await supabase
    .from("stories")
    .select(STORY_COLUMNS)
    .eq("id", candidate.story_id)
    .maybeSingle();

  if (storyErr) throw new Error(`[social-post-generator] fetch story: ${storyErr.message}`);
  if (!story) throw new Error(`[social-post-generator] story not found: ${candidate.story_id}`);

  // Phase 5: a candidate the selector marked AUTO_APPROVED produces drafts that
  // skip human review. Instagram is excluded — it needs a media asset, so it
  // always stays PENDING_REVIEW (and the publisher's media gate blocks it anyway).
  const autoApproved = candidate.status === "AUTO_APPROVED";
  const statusFor = (platform) =>
    autoApproved && platform.PLATFORM !== "instagram" ? "APPROVED" : "PENDING_REVIEW";

  let created = 0;
  let skipped = 0;

  for (const platform of PLATFORMS) {
    // Idempotency (§12.2): skip if a post already exists for this triple.
    const { data: existing, error: exErr } = await supabase
      .from("social_posts")
      .select("id")
      .eq("story_id", story.id)
      .eq("platform", platform.PLATFORM)
      .eq("audience_geo", candidate.audience_geo)
      .maybeSingle();

    if (exErr) throw new Error(`[social-post-generator] check existing: ${exErr.message}`);
    if (existing) { skipped++; continue; }

    const post = await generatePlatformPost({
      platform, story, audienceGeo: candidate.audience_geo, anthropic, logger,
    });

    // Race-safe insert: ignoreDuplicates handles a concurrent generator.
    const { data: inserted, error: insErr } = await supabase
      .from("social_posts")
      .upsert(
        {
          story_id: story.id,
          candidate_id: candidate.id,
          platform: platform.PLATFORM,
          audience_geo: candidate.audience_geo,
          post_text: post.text,
          media_url: post.mediaUrl || null,
          link_url: post.linkUrl || null,
          status: statusFor(platform),
        },
        { onConflict: "story_id,platform,audience_geo", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();

    if (insErr) throw new Error(`[social-post-generator] insert post: ${insErr.message}`);

    if (inserted) {
      created++;
      logger(JSON.stringify({
        event: "social_post_generated",
        post_id: inserted.id,
        story_id: story.id,
        platform: platform.PLATFORM,
        audience_geo: candidate.audience_geo,
        requires_media: !!post.requiresMedia,
      }));
    } else {
      skipped++;
    }
  }

  // Advance candidate to POST_GENERATED (§7.2), unless it already moved past it.
  // AUTO_APPROVED is preserved so the selector's per-day auto cap keeps counting
  // it for the rest of the day (Phase 5); POSTED/FAILED are terminal.
  if (!["POSTED", "FAILED", "AUTO_APPROVED"].includes(candidate.status)) {
    const { error: updErr } = await supabase
      .from("social_publication_candidates")
      .update({ status: "POST_GENERATED", updated_at: new Date().toISOString() })
      .eq("id", candidate.id);
    if (updErr) throw new Error(`[social-post-generator] update candidate: ${updErr.message}`);
  }

  return { created, skipped };
}
