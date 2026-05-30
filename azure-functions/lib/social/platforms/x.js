// X (Twitter) post formatter. Design §8.1.
//
// Exports:
//   PLATFORM, CONSTRAINTS
//   format(story, audienceGeo)  → deterministic draft (no LLM, can't hallucinate)
//   buildPrompt(story, audienceGeo) → Claude prompt to produce native copy

import {
  QUYDLY_URL, keyPointStrings, firstSentences, truncate, bullets,
} from "./_shared.js";
import { buildAuthHeader } from "../x-oauth1.js";

export const PLATFORM = "x";

export const CONSTRAINTS = {
  maxLength: 280,
  targetLength: 260,
  requiresMedia: false,
  allowHashtags: false,
};

// X counts every URL as a fixed-weight t.co link (currently 23 chars),
// regardless of the URL's real length. A tweet whose raw length is ≤280 can
// therefore exceed X's weighted 280 and have its trailing URL stripped — which
// is exactly what dropped the quydly.com CTA on the first live post. Budget
// against this weighted length so the CTA always survives.
const TCO_URL_WEIGHT = 23;
const URL_RE = /https?:\/\/\S+|\b[a-z0-9-]+\.(?:com|org|net|io|co)\b\S*/gi;

// X-weighted length of a string: each URL contributes TCO_URL_WEIGHT.
export function weightedLength(text) {
  let urls = 0;
  const stripped = String(text).replace(URL_RE, () => { urls += TCO_URL_WEIGHT; return ""; });
  return stripped.length + urls;
}

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Deterministic build: headline + (optional) one-line summary + (optional)
// "Why it matters" bullets + CTA. Budgeted by X-weighted length so the CTA
// (which contains the URL) is never truncated by X.
export function format(story, audienceGeo) {
  const url = QUYDLY_URL();
  const cta = `Take today's news quiz: ${url}`;
  const headline = oneLine(story.headline);
  const summary = firstSentences(story.summary, 1);
  const kps = keyPointStrings(story).slice(0, 2);
  const why = kps.length ? `Why it matters:\n${bullets(kps)}` : "";

  // Reserve the CTA's weighted cost + the "\n\n" separator from the 280 budget.
  const budget = CONSTRAINTS.maxLength - weightedLength(cta) - 2;
  let body = truncate(headline, budget);

  if (summary && summary !== headline && body.length + 2 + summary.length <= budget) {
    body += `\n\n${summary}`;
  }
  if (why && body.length + 2 + why.length <= budget) {
    body += `\n\n${why}`;
  }

  const text = `${body}\n\n${cta}`;

  return {
    platform: PLATFORM,
    text,
    mediaUrl: null,
    linkUrl: url,
    requiresMedia: false,
    audienceGeo,
  };
}

// Publish a post to X via API v2 POST /2/tweets using OAuth 1.0a User Context
// (four static app-owned credentials). Returns { platformPostId, rawResponse }.
// Throws on non-2xx so the worker can persist the failure and retry.
// The JSON body is not part of the OAuth 1.0a signature (only oauth_* params are).
export async function publish(post, { creds, fetchImpl = fetch } = {}) {
  if (!creds) throw new Error("X publish: missing OAuth 1.0a creds");
  const text = String(post.post_text || post.text || "");
  if (!text) throw new Error("X publish: empty post text");

  const url = "https://api.x.com/2/tweets";
  const authHeader = buildAuthHeader({ method: "POST", url, creds });

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = raw.detail || raw.title || JSON.stringify(raw).slice(0, 300);
    throw new Error(`X publish failed (${res.status}): ${detail}`);
  }

  const platformPostId = raw?.data?.id;
  if (!platformPostId) throw new Error(`X publish: no tweet id in response: ${JSON.stringify(raw).slice(0, 200)}`);

  return { platformPostId, rawResponse: raw };
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
