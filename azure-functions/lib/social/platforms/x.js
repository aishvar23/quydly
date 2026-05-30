// X (Twitter) post formatter. Design §8.1.
//
// Exports:
//   PLATFORM, CONSTRAINTS
//   format(story, audienceGeo)  → deterministic draft (no LLM, can't hallucinate)
//   buildPrompt(story, audienceGeo) → Claude prompt to produce native copy

import {
  QUYDLY_URL, keyPointStrings, firstSentences, truncate, bullets,
} from "./_shared.js";

export const PLATFORM = "x";

export const CONSTRAINTS = {
  maxLength: 280,
  targetLength: 260,
  requiresMedia: false,
  allowHashtags: false,
};

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Deterministic build: headline + (optional) one-line summary + (optional)
// "Why it matters" bullets + CTA. Space for the CTA is reserved first so it is
// never dropped.
export function format(story, audienceGeo) {
  const url = QUYDLY_URL();
  const cta = `Take today's news quiz: ${url}`;
  const headline = oneLine(story.headline);
  const summary = firstSentences(story.summary, 1);
  const kps = keyPointStrings(story).slice(0, 2);
  const why = kps.length ? `Why it matters:\n${bullets(kps)}` : "";

  const budget = CONSTRAINTS.maxLength - cta.length - 2; // reserve "\n\n" + cta
  let body = truncate(headline, budget);

  if (summary && summary !== headline && body.length + 2 + summary.length <= budget) {
    body += `\n\n${summary}`;
  }
  if (why && body.length + 2 + why.length <= budget) {
    body += `\n\n${why}`;
  }

  const text = truncate(`${body}\n\n${cta}`, CONSTRAINTS.maxLength);

  return {
    platform: PLATFORM,
    text,
    mediaUrl: null,
    linkUrl: url,
    requiresMedia: false,
    audienceGeo,
  };
}

export function buildPrompt(story, audienceGeo) {
  const facts = keyPointStrings(story).map((k, i) => `${i + 1}. ${k}`).join("\n") || "(none)";
  return `You write concise, factual posts for Quydly, a daily news quiz, for the X (Twitter) account.

Audience region: ${audienceGeo}

VERIFIED STORY (use ONLY these facts — do not add anything not stated here):
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${facts}

Write ONE X post following this shape:
{headline}

{one concise sentence}

Why it matters:
• {point}
• {point}

Take today's news quiz: ${QUYDLY_URL()}

RULES:
- Hard limit ${CONSTRAINTS.maxLength} characters; aim for ${CONSTRAINTS.targetLength}.
- Must end with the quiz CTA and URL.
- No hashtags. No source links. No invented facts, numbers, or quotes.
- Do not say "breaking". Do not overstate certainty.

Respond ONLY with JSON, no markdown: { "post_text": "..." }`;
}
