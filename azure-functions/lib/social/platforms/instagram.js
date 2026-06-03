// Instagram caption formatter. Design §8.3.
//
// Instagram is visual-first: the MVP generates a CAPTION only and flags the post
// as requiring a media asset (square card) before it can be published. No source
// links in the caption.

import {
  QUYDLY_URL, keyPointStrings, firstSentences, truncate, bullets, assemble,
} from "./_shared.js";

export const PLATFORM = "instagram";

export const CONSTRAINTS = {
  maxLength: 1500,
  requiresMedia: true, // §10.3 / acceptance #16 — must have a card before publish
  cardShape: "square", // 1:1 card satisfies the media gate
  // L4 carousel: when enabled, the media asset is a 4-slide carousel
  // (cover / what happened / why it matters / CTA) rather than a single card.
  carousel: true,
  // Unlike X, Instagram treats hashtags as a discovery surface. A curated block
  // is appended downstream (see _hashtags.js, gated by SOCIAL_IG_HASHTAGS_ENABLED);
  // validation must not reject the '#' token here.
  allowHashtags: true,
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
- Max ${CONSTRAINTS.maxLength} characters. No source links in the caption.
- Must include the "Visit ${QUYDLY_URL()}" CTA. No invented facts or numbers.
- Neutral tone for any sensitive subject. No clickbait.
- Do NOT add hashtags yourself — a curated hashtag block is appended automatically.

Respond ONLY with JSON, no markdown: { "post_text": "..." }`;
}
