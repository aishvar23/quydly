// Instagram caption formatter. Design §8.3.
//
// Instagram is visual-first: the MVP generates a CAPTION only and flags the post
// as requiring a media asset (square card) before it can be published. Source
// links and the curated hashtag block are NOT part of the body the LLM/
// deterministic formatter produces — they are appended DOWNSTREAM, after
// validation (see _sources.js / _hashtags.js / social-post-generator.js).

import {
  QUYDLY_URL, keyPointStrings, firstSentences, truncate, bullets, assemble,
} from "./_shared.js";

export const PLATFORM = "instagram";

export const CONSTRAINTS = {
  maxLength: 1500,
  requiresMedia: true, // §10.3 / acceptance #16 — must have a card before publish
  cardShape: "square", // 1:1 card satisfies the media gate
  cardFormat: "jpeg",  // IG's Graph API rejects PNG — render the card as JPEG
  // L4 carousel: when enabled, the media asset is a 4-slide carousel
  // (cover / what happened / why it matters / CTA) rather than a single card.
  carousel: true,
  // Instagram treats hashtags as a discovery surface, but the curated block is
  // appended DOWNSTREAM — after validation (see _hashtags.js /
  // social-post-generator.js), so the validator never sees it. We therefore
  // still reject hashtags the LLM puts in the caption BODY: a stray model #tag
  // would otherwise survive beside the curated set, producing duplicate/
  // uncurated tags and defeating the "curated block" guarantee. Rejection falls
  // back to the deterministic draft (hashtag-free), onto which the curated block
  // is then appended cleanly.
  allowHashtags: false,
};

export function format(story, audienceGeo) {
  const url = QUYDLY_URL();
  const headline = String(story.headline || "").replace(/\s+/g, " ").trim();
  const summary = firstSentences(story.summary, 1);
  const kps = keyPointStrings(story).slice(0, 3);
  const know = kps.length ? `What to know:\n${bullets(kps)}` : "";
  const cta = `Can you answer today's news quiz?\nVisit ${url}`;

  const text = truncate(
    assemble([headline, summary, know, cta], CONSTRAINTS.maxLength),
    CONSTRAINTS.maxLength
  );

  return {
    platform: PLATFORM,
    text,
    mediaUrl: null,       // no asset yet — flagged via requiresMedia
    linkUrl: url,
    requiresMedia: true,
    audienceGeo,
  };
}

export function buildPrompt(story, audienceGeo) {
  const facts = keyPointStrings(story).map((k, i) => `${i + 1}. ${k}`).join("\n") || "(none)";
  return `You write factual captions for Quydly, a daily news quiz, for the Instagram account.

Audience region: ${audienceGeo}

VERIFIED STORY (use ONLY these facts — do not add anything not stated here):
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${facts}

Write ONE Instagram caption following this shape:
{headline}

{short summary}

What to know:
• {point}
• {point}
• {point}

Can you answer today's news quiz?
Visit ${QUYDLY_URL()}

RULES:
- Max ${CONSTRAINTS.maxLength} characters. Do NOT add source links yourself — a
  "Sources" block is appended automatically.
- Must include the "Visit ${QUYDLY_URL()}" CTA. No invented facts or numbers.
- Neutral tone for any sensitive subject. No clickbait.
- Do NOT add hashtags yourself — a curated hashtag block is appended automatically.

Respond ONLY with JSON, no markdown: { "post_text": "..." }`;
}

// ── Carousel "Why it matters" slide (L4) ─────────────────────────────────────
//
// The carousel's third slide carries two blocks: "Key points" (today's
// key_points, rendered deterministically by card-renderer) and "Why it matters"
// — 3 HISTORICAL-context points generated here. Unlike the rest of the pipeline,
// this block is allowed to reach beyond today's verified facts to draw a
// historical link, so the prompt is grounded-first (our own related_stories +
// timeline_events) with a hard "omit if unsure" guard against invented
// dates/numbers/names. Empty output → card-renderer shows the Key points block
// only (never worse than the pre-feature slide).

function ow(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// stories.related_stories is jsonb: [{ id, headline, date }] (synthesiser
// pickRelatedStories — prior same-category coverage sharing ≥2 entities).
function relatedStoryLines(story) {
  const rel = story && story.related_stories;
  if (!Array.isArray(rel)) return "(none on file)";
  const lines = rel
    .map((r) => {
      if (!r || typeof r !== "object") return "";
      const head = ow(r.headline);
      if (!head) return "";
      const date = ow(r.date);
      return date ? `- ${date}: ${head}` : `- ${head}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "(none on file)";
}

// stories.timeline_events is jsonb: [{ date, label, source_id }] (enrichment).
function timelineLines(story) {
  const tl = story && story.timeline_events;
  if (!Array.isArray(tl)) return "(none on file)";
  const lines = tl
    .map((e) => {
      if (!e || typeof e !== "object") return "";
      const label = ow(e.label);
      if (!label) return "";
      const date = ow(e.date);
      return date ? `- ${date}: ${label}` : `- ${label}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "(none on file)";
}

export const WHY_IT_MATTERS_SYSTEM = `You write the "Why it matters" block for Quydly's daily news quiz Instagram carousel.
Your job is to connect today's story to its HISTORICAL CONTEXT — the precedents, the
longer arc, and what led up to this moment — so a reader sees why it matters beyond
today's headline.

You are given (a) today's verified story and (b) related prior coverage and a timeline
from Quydly's own archive. Ground every point in that material first.

RULES
- Produce exactly 3 short points. Each ≤ 14 words. No trailing period, no emoji,
  no hashtags.
- Each point must draw a HISTORICAL link, not restate today's news. Good angles:
  "third rate cut since 2023", "echoes the 2008 crisis", "part of a decade-long
  trend", "reverses a policy in place since…", "the last time this happened, …".
- Do NOT restate today's events or their near-term consequences — every point must
  reference something that predates this story.
- Prefer facts in the provided archive material. You MAY add widely-documented
  historical context from general knowledge ONLY when highly confident it is accurate.
  If unsure of any date, number, name, or claim, omit it — never guess.
- Do not use the words "first", "never", "unprecedented", "largest", or similar
  superlatives unless that exact claim appears in the provided material.
- No predictions about the future. No opinion or editorialising. Neutral tone on any
  sensitive subject.
- If there is no meaningful, verifiable historical link, return fewer points (or an
  empty array) rather than inventing one.

Respond ONLY with JSON, no markdown:
{ "points": ["...", "...", "..."] }`;

export function buildWhyItMattersPrompt(story) {
  const facts = keyPointStrings(story).map((k, i) => `${i + 1}. ${k}`).join("\n") || "(none)";
  const stakes = ow(story?.why_it_matters) || "(none)";
  return `TODAY'S STORY
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${facts}
Stakes: ${stakes}

QUYDLY ARCHIVE — RELATED PRIOR COVERAGE (primary grounding)
${relatedStoryLines(story)}

TIMELINE ON FILE
${timelineLines(story)}

Write the 3 historical "Why it matters" points now.`;
}

// ── Engagement slide MCQ (carousel second-to-last slide) ─────────────────────
//
// The engagement slide poses a multiple-choice question drawn from the PREVIOUS
// post's story — the most recent POSTED IG post for the SAME audience_geo — and
// invites followers to reply with their pick. Twelve hours later the answer is
// (eventually) posted as a comment on the IG media. This mirrors X's
// generateQuizQuestion, but the question is about YESTERDAY'S news (so a reader
// who already saw the prior post can answer it), not today's.
//
// Best-effort: no prior post, no story, an LLM/parse failure, or an invalid MCQ
// → returns null. The renderer then drops the engagement slide entirely (silent
// fallback to the current carousel), so this can never make a post worse.

const ENGAGEMENT_QUESTION_MODEL = "claude-sonnet-4-6";

// Columns the engagement MCQ prompt needs from the previous post's story.
const ENGAGEMENT_STORY_COLUMNS = "id, headline, summary, key_points, category_id";

function buildEngagementPrompt(story, audienceGeo) {
  const facts = keyPointStrings(story).map((k, i) => `${i + 1}. ${k}`).join("\n") || "(none)";
  return `You write a single multiple-choice quiz question for Quydly (a daily news quiz) from a news story we posted to Instagram YESTERDAY. The question goes on a carousel slide and followers answer it in a comment; the answer is revealed in a comment the next day.

Audience region: ${audienceGeo}

YESTERDAY'S STORY (use ONLY these facts — invent nothing):
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${facts}

The slide shows ONLY your question and the four options — NOT the headline — so the reader answers from memory of yesterday's post. Ask about the gist a reader would remember: who did what, to whom, why it matters, or the direction of a change. Never test recall of an exact number, date, percentage, or amount.

Write the question:
- Punchy, jargon-free, answerable from the gist of the story.
- Exactly 4 options: 1 correct, 3 plausible but clearly distinct distractors of the same kind (don't mix a number among names).
- correctIndex is the 0-based index of the correct option.
- The question must contain NO URL/link, NO hashtag, and not the word "breaking".

Respond ONLY with valid JSON, no markdown:
{ "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 }`;
}

// Find the most recent POSTED IG post for this audience_geo and return its story
// row, or null. ORDER BY published_at DESC LIMIT 1. `excludeStoryId` skips the
// current candidate's own story (it can't be "yesterday's" question for itself).
async function previousPostedStory({ supabase, audienceGeo, excludeStoryId, logger }) {
  try {
    let postQuery = supabase
      .from("social_posts")
      .select("id, story_id, published_at")
      .eq("platform", "instagram")
      .eq("audience_geo", audienceGeo)
      .eq("status", "POSTED")
      .not("published_at", "is", null);
    if (excludeStoryId != null) postQuery = postQuery.neq("story_id", excludeStoryId);
    const { data: prevPost, error: postErr } = await postQuery
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (postErr) throw postErr;
    if (!prevPost) return null;

    const { data: story, error: storyErr } = await supabase
      .from("stories")
      .select(ENGAGEMENT_STORY_COLUMNS)
      .eq("id", prevPost.story_id)
      .maybeSingle();
    if (storyErr) throw storyErr;
    if (!story) return null;
    return { story, sourcePostId: prevPost.id };
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "ig_engagement_prev_post_failed", audience_geo: audienceGeo, error: err.message }));
    return null;
  }
}

// Generate ONE engagement MCQ for the carousel's engagement slide, sourced from
// the PREVIOUS post's story. Returns
//   { question, options, correctIndex, answer, sourcePostId }
// or null on any failure (no prior post, no story, LLM/parse error, invalid MCQ)
// — the carousel then renders without an engagement slide. Never throws.
export async function generateEngagementQuestion({ anthropic, supabase, story, audienceGeo, logger } = {}) {
  if (!anthropic || !supabase) return null;
  const prev = await previousPostedStory({ supabase, audienceGeo, excludeStoryId: story?.id, logger });
  if (!prev) return null;

  try {
    const msg = await anthropic.messages.create({
      model: ENGAGEMENT_QUESTION_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: buildEngagementPrompt(prev.story, audienceGeo) }],
    });

    let raw = String(msg?.content?.[0]?.text || "").trim();
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const q = JSON.parse(raw);

    const valid =
      q &&
      typeof q.question === "string" && q.question.trim() &&
      Array.isArray(q.options) && q.options.length === 4 &&
      q.options.every((o) => typeof o === "string" && o.trim()) &&
      Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3;

    if (!valid) {
      logger?.warn?.(JSON.stringify({ event: "ig_engagement_invalid", source_story_id: prev.story.id }));
      return null;
    }

    const options = q.options.map((o) => o.trim());
    return {
      question: q.question.trim(),
      options,
      correctIndex: q.correctIndex,
      answer: options[q.correctIndex],
      sourcePostId: prev.sourcePostId,
    };
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "ig_engagement_generation_failed", source_story_id: prev.story.id, error: err.message }));
    return null;
  }
}
