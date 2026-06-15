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

import { PLATFORM_MODULES, requiresMedia } from "./platforms/index.js";
import { validatePost } from "./social-validation.js";
import { appendHashtags } from "./platforms/_hashtags.js";

const PLATFORMS = PLATFORM_MODULES;
const MODEL = "claude-sonnet-4-20250514";

const STORY_COLUMNS =
  "id, headline, summary, category_id, key_points, source_count, story_score, confidence_score, primary_entities, primary_entities_enriched, published_at, why_it_matters, related_stories, timeline_events";

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

// Generate the carousel's historical "Why it matters" points (L4). Returns an
// array of ≤3 short strings, or [] on any failure — the renderer then shows the
// "Key points" block alone, so a failure here is never worse than the pre-feature
// slide. Best-effort and additive: it must not throw into the platform loop.
async function generateWhyItMatters(anthropic, platform, story, logger) {
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: platform.WHY_IT_MATTERS_SYSTEM,
      messages: [{ role: "user", content: platform.buildWhyItMattersPrompt(story) }],
    });

    let raw = String(msg?.content?.[0]?.text || "").trim();
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    const parsed = JSON.parse(raw);
    const points = Array.isArray(parsed?.points) ? parsed.points : [];
    return points
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    logger.warn(JSON.stringify({
      event: "social_why_it_matters_failed",
      platform: platform.PLATFORM,
      story_id: story.id,
      error: err.message,
    }));
    return [];
  }
}

// Build one platform draft. Deterministic by default; LLM copy only when it
// passes validation. When a cardService is supplied and the platform declares a
// cardShape, a rendered headline card is attached (best-effort — null on failure
// leaves the draft text-only, exactly as before).
export async function generatePlatformPost({ platform, story, audienceGeo, anthropic, cardService = null, igCarousel = false, logger = noopLogger }) {
  const draft = platform.format(story, audienceGeo); // deterministic base

  if (cardService && platform.CONSTRAINTS) {
    // Instagram carousel (L4): a 4-slide set replaces the single square card.
    // The cover slide doubles as media_url (admin preview + single-image
    // fallback); the full ordered set is persisted as social_media_assets rows.
    if (igCarousel && platform.CONSTRAINTS.carousel && cardService.getCarouselSlideUrls) {
      // The "Why it matters" slide carries LLM-generated historical points
      // alongside the deterministic "Key points". Best-effort: [] on failure
      // leaves the renderer to show Key points alone.
      let whyItMatters = [];
      if (anthropic && platform.buildWhyItMattersPrompt) {
        whyItMatters = await generateWhyItMatters(anthropic, platform, story, logger);
      }
      const slides = await cardService.getCarouselSlideUrls({ story, whyItMatters });
      if (slides && slides.length) {
        draft.carouselSlides = slides;
        draft.mediaUrl = slides[0].url;
        draft.requiresMedia = false;
      }
    } else if (platform.CONSTRAINTS.cardShape) {
      // Single card. The render format is declared by the platform's CONSTRAINTS
      // (Meta Graph platforms set cardFormat "jpeg" — IG's Graph API rejects PNG,
      // FB /photos posts the same square JPEG; X has no cardFormat → PNG).
      const format = platform.CONSTRAINTS.cardFormat || "png";
      const mediaUrl = await cardService.getCardUrl({ story, shape: platform.CONSTRAINTS.cardShape, format });
      if (mediaUrl) {
        draft.mediaUrl = mediaUrl;
        draft.requiresMedia = false; // asset now present
      }
    }
  }

  // Platforms that support a posed quiz question (X) generate + persist a
  // STRUCTURED MCQ (downstream) so the publisher's reply can link to the answer
  // page; the tweet wording IS the persisted question, so tweet and page stay
  // identical. The question tweet is TEXT-ONLY — never the headline card, which
  // would reveal the answer in the same tweet. On generation failure we fall
  // back to the deterministic draft (no second LLM call, no answer link), not
  // the generic engagement copy below.
  if (anthropic && platform.generateQuizQuestion) {
    const question = await platform.generateQuizQuestion({ anthropic, story, audienceGeo, logger });
    if (question) {
      const qDraft = platform.formatQuestionTweet(question, story, audienceGeo);
      return { ...draft, text: qDraft.text, mediaUrl: null, requiresMedia: false, question };
    }
    return draft;
  }

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

export async function generateSocialPosts({ supabase, anthropic = null, cardService = null, igCarousel = false, igHashtags = false, candidateId, logger = noopLogger }) {
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

  // Phase 5 + L4: a candidate the selector marked AUTO_APPROVED produces drafts
  // that skip human review. Instagram auto-approves ONLY once it has a media
  // asset (its carousel slides / square card → post.mediaUrl is set). The earlier
  // blanket IG exclusion existed because IG had no media; the carousel now
  // provides it. Without media, IG stays PENDING_REVIEW and the publisher's media
  // gate (#16) blocks it anyway.
  const autoApproved = candidate.status === "AUTO_APPROVED";
  // Platforms whose published format requires a media asset auto-approve ONLY
  // once that asset (post.mediaUrl) is present; without it they stay
  // PENDING_REVIEW and the publisher's media gate blocks them anyway. Whether a
  // platform requires media is derived from CONSTRAINTS.requiresMedia (single
  // source of truth — see platforms/index.js), not a hand-maintained list.
  const statusFor = (platform, post) => {
    if (!autoApproved) return "PENDING_REVIEW";
    if (requiresMedia(platform.PLATFORM) && !post.mediaUrl) return "PENDING_REVIEW";
    return "APPROVED";
  };

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
      platform, story, audienceGeo: candidate.audience_geo, anthropic, cardService, igCarousel, logger,
    });

    // Append the curated hashtag block to IG captions (reach §8.3). Done here —
    // after generatePlatformPost (so it covers the LLM, validation-fallback, and
    // deterministic paths uniformly) and after validation (so hashtags never trip
    // the validator). IG-only; X/Facebook are untouched.
    if (igHashtags && platform.PLATFORM === "instagram") {
      post.text = appendHashtags(post.text, story);
    }

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
          status: statusFor(platform, post),
        },
        { onConflict: "story_id,platform,audience_geo", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();

    if (insErr) throw new Error(`[social-post-generator] insert post: ${insErr.message}`);

    if (inserted) {
      created++;

      // Persist the tweeted question so quydly.com/question/<id> can serve it,
      // and link it to the post so the publisher's reply can build the URL.
      // Only X sets post.question; runs after a confirmed insert (no orphans).
      // NON-FATAL: this is an additive enhancement — a failure here must not
      // abort the run (the post is already committed and will still publish,
      // just without an answer-link reply) nor block the candidate's advance.
      if (post.question) {
        try {
          const { data: sq, error: sqErr } = await supabase
            .from("social_questions")
            .insert({
              story_id: story.id,
              audience_geo: candidate.audience_geo,
              question: post.question.question,
              options: post.question.options,
              correct_index: post.question.correctIndex,
              tldr: post.question.tldr,
              category_id: story.category_id,
            })
            .select("id")
            .single();
          if (sqErr) throw sqErr;

          const { error: linkErr } = await supabase
            .from("social_posts")
            .update({ social_question_id: sq.id })
            .eq("id", inserted.id);
          if (linkErr) throw linkErr;
        } catch (qErr) {
          logger.warn(JSON.stringify({
            event: "social_question_persist_failed",
            post_id: inserted.id,
            story_id: story.id,
            error: qErr.message,
          }));
        }
      }

      // Persist carousel slides as ordered social_media_assets rows (the
      // publisher reads these by position). Idempotent on (post, position).
      if (post.carouselSlides && post.carouselSlides.length) {
        const assetRows = post.carouselSlides.map((s) => ({
          story_id: story.id,
          social_post_id: inserted.id,
          asset_type: "instagram_carousel_slide",
          asset_url: s.url,
          position: s.index,
          width: s.width,
          height: s.height,
          format: "jpeg",
          status: "READY",
        }));
        const { error: assetErr } = await supabase
          .from("social_media_assets")
          .upsert(assetRows, { onConflict: "social_post_id,position", ignoreDuplicates: true });
        if (assetErr) throw new Error(`[social-post-generator] insert carousel assets: ${assetErr.message}`);
      }

      logger(JSON.stringify({
        event: "social_post_generated",
        post_id: inserted.id,
        story_id: story.id,
        platform: platform.PLATFORM,
        audience_geo: candidate.audience_geo,
        requires_media: !!post.requiresMedia,
        carousel_slides: post.carouselSlides ? post.carouselSlides.length : 0,
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
