// Facebook post formatter. Design §8.2.
//
// More explanatory than X: two-sentence summary + up to three numbered points
// + Quydly CTA. Up to 900 characters.

import {
  QUYDLY_URL, keyPointStrings, firstSentences, truncate, numbered, assemble,
} from "./_shared.js";

export const PLATFORM = "facebook";

export const CONSTRAINTS = {
  maxLength: 900,
  // The locked Facebook post format is a single square card image + caption
  // (published via POST /{pageId}/photos). The generator renders a 1080×1080
  // JPEG card for this shape and sets it on media_url; the publisher then gates
  // Facebook on media presence the same way it gates Instagram.
  requiresMedia: true,
  cardShape: "square",
};

export function format(story, audienceGeo) {
  const url = QUYDLY_URL();
  const headline = String(story.headline || "").replace(/\s+/g, " ").trim();
  const summary = firstSentences(story.summary, 2);
  const kps = keyPointStrings(story).slice(0, 3);
  const know = kps.length ? `What to know:\n${numbered(kps)}` : "";
  const cta = `Try the 5-question Quydly news quiz: ${url}`;

  const text = truncate(
    assemble([headline, summary, know, cta], CONSTRAINTS.maxLength),
    CONSTRAINTS.maxLength
  );

  return {
    platform: PLATFORM,
    text,
    mediaUrl: null,
    linkUrl: url,
    requiresMedia: true, // single-card-image format — set false once a card attaches
    audienceGeo,
  };
}

export function buildPrompt(story, audienceGeo) {
  const facts = keyPointStrings(story).map((k, i) => `${i + 1}. ${k}`).join("\n") || "(none)";
  return `You write factual, non-sensational posts for Quydly, a daily news quiz, for the Facebook page.

Audience region: ${audienceGeo}

VERIFIED STORY (use ONLY these facts — do not add anything not stated here):
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${facts}

Write ONE Facebook post following this shape:
{headline}

{two sentence summary}

What to know:
1. {point}
2. {point}
3. {point}

Try the 5-question Quydly news quiz: ${QUYDLY_URL()}

RULES:
- Max ${CONSTRAINTS.maxLength} characters. Include 2–3 key points.
- Must include the Quydly CTA and URL.
- Avoid sensational wording. No raw source list. No invented facts or numbers.

Respond ONLY with JSON, no markdown: { "post_text": "..." }`;
}
