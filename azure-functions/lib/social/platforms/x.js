// X (Twitter) post formatter. Design §8.1.
//
// Exports:
//   PLATFORM, CONSTRAINTS
//   format(story, audienceGeo)  → deterministic draft (no LLM, can't hallucinate)
//   buildPrompt(story, audienceGeo) → Claude prompt to produce native copy

import {
  keyPointStrings, firstSentences, truncate,
} from "./_shared.js";
import { cashtagsFor } from "./_cashtags.js";
import { buildAuthHeader } from "../x-oauth1.js";

export const PLATFORM = "x";

export const CONSTRAINTS = {
  maxLength: 280,
  targetLength: 260,
  requiresMedia: false,
  allowHashtags: false,
  // Cashtags ($AAPL) are allowed — they aid discovery on finance stories without
  // the spam penalty hashtags carry. Hashtags stay off.
  allowCashtags: true,
  // A headline card lifts reach materially on X; attached when a card service is
  // available, but not required (text-only posts still publish).
  cardShape: "landscape",
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

// Engagement-first X post: headline + one-sentence summary + a reply hook +
// "full quiz is in our bio" CTA (no link — a URL raises API cost and pushes
// users off X; we drive replies + profile/bio visits instead). The real
// per-story quiz question comes from the LLM (buildPrompt); this deterministic
// fallback can't pose a story-specific question, so it uses a generic reply hook.
// Cashtags ($AAPL) still append for finance stories. Budgeted by X-weighted length.
const HOOK = "\u{1F9E0} Think you know today's news? Reply with your take \u{1F447}";
const BIO_CTA = "Today's full quiz is in our bio.";

export function format(story, audienceGeo) {
  const tail = `${HOOK}\n${BIO_CTA}`;
  const headline = oneLine(story.headline);
  const summary = firstSentences(story.summary, 1);

  const cashtags = CONSTRAINTS.allowCashtags ? cashtagsFor(story) : [];
  const tagLine = cashtags.length ? `\n\n${cashtags.join(" ")}` : "";

  // Reserve the tail's weighted cost + the "\n\n" separator + the tag line from
  // the 280 budget. Cashtags carry no t.co weight, so their raw length applies.
  const budget = CONSTRAINTS.maxLength - weightedLength(tail) - 2 - tagLine.length;
  let body = truncate(headline, budget);

  if (summary && summary !== headline && body.length + 2 + summary.length <= budget) {
    body += `\n\n${summary}`;
  }

  const text = `${body}\n\n${tail}${tagLine}`;

  return {
    platform: PLATFORM,
    text,
    mediaUrl: null,
    linkUrl: null, // X posts carry no link — drives replies + bio visits instead
    requiresMedia: false,
    audienceGeo,
  };
}

// Upload an image to X (v1.1 media/upload) and return its media_id_string. The
// bytes go as multipart/form-data — which, like a JSON body, is NOT part of the
// OAuth 1.0a signature (only the oauth_* params are), so buildAuthHeader signs
// the bare URL. media_ids from this endpoint attach to a v2 tweet.
const X_MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const MULTIPART_BOUNDARY = "----QuydlyCardBoundary7MA4YWxkTrZu0gW";

function multipartImageBody(buffer, contentType) {
  const head = Buffer.from(
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="media"; filename="card.png"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${MULTIPART_BOUNDARY}--\r\n`);
  return Buffer.concat([head, buffer, tail]);
}

export async function uploadMedia(buffer, contentType, { creds, fetchImpl = fetch } = {}) {
  if (!creds) throw new Error("X media upload: missing OAuth 1.0a creds");
  const authHeader = buildAuthHeader({ method: "POST", url: X_MEDIA_UPLOAD_URL, creds });

  const res = await fetchImpl(X_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
    },
    body: multipartImageBody(buffer, contentType),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = raw.errors ? JSON.stringify(raw.errors).slice(0, 300) : JSON.stringify(raw).slice(0, 300);
    throw new Error(`X media upload failed (${res.status}): ${detail}`);
  }
  const id = raw.media_id_string || (raw.media_id != null ? String(raw.media_id) : null);
  if (!id) throw new Error(`X media upload: no media_id in response: ${JSON.stringify(raw).slice(0, 200)}`);
  return id;
}

// Fetch the rendered card bytes from its stored public URL.
async function fetchMediaBytes(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`fetch media ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers?.get?.("content-type") || "image/png";
  return { buffer: buf, contentType };
}

// Publish a post to X via API v2 POST /2/tweets using OAuth 1.0a User Context
// (four static app-owned credentials). When the post has a media_url, its card
// is uploaded first and attached via media.media_ids — a media upload failure
// is non-fatal and falls back to a text-only tweet (reach beats silence).
// Returns { platformPostId, rawResponse }. Throws on a non-2xx tweet create.
// The JSON body is not part of the OAuth 1.0a signature (only oauth_* params are).
export async function publish(post, { creds, fetchImpl = fetch, logger } = {}) {
  if (!creds) throw new Error("X publish: missing OAuth 1.0a creds");
  const text = String(post.post_text || post.text || "");
  if (!text) throw new Error("X publish: empty post text");

  const body = { text };
  const mediaUrl = post.media_url || post.mediaUrl;
  if (mediaUrl) {
    try {
      const { buffer, contentType } = await fetchMediaBytes(mediaUrl, fetchImpl);
      const mediaId = await uploadMedia(buffer, contentType, { creds, fetchImpl });
      body.media = { media_ids: [mediaId] };
    } catch (mediaErr) {
      logger?.warn?.(JSON.stringify({ event: "x_media_attach_failed", error: mediaErr.message }));
    }
  }

  const url = "https://api.x.com/2/tweets";
  const authHeader = buildAuthHeader({ method: "POST", url, creds });

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
  const cashtags = CONSTRAINTS.allowCashtags ? cashtagsFor(story) : [];
  const cashtagRule = cashtags.length
    ? `- You MAY end (after the CTA, on a new line) with these EXACT cashtags and no others: ${cashtags.join(" ")}`
    : `- No cashtags.`;
  const cashtagShape = cashtags.length ? `\n\n${cashtags.join(" ")}` : "";
  return `You write engaging posts for Quydly (a daily news quiz) on the X account. Your goal is REPLIES: pair a news headline with ONE short quiz question about the story that followers answer in a reply.

Audience region: ${audienceGeo}

VERIFIED STORY (use ONLY these facts — do not add anything not stated here):
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${facts}

Write ONE X post in this shape:
{headline}

🧠 Quiz: {one short question about this story, answerable in a few words}

Reply with your answer 👇 Today's full quiz is in our bio.${cashtagShape}

RULES:
- Hard limit ${CONSTRAINTS.maxLength} characters; aim for ${CONSTRAINTS.targetLength}.
- Ask exactly ONE question, and do NOT reveal the answer.
- Must end by inviting a reply AND saying the full quiz is "in our bio".
- Do NOT include any URL or link (no quydly.com, no http).
- No hashtags (the # symbol). No invented facts, numbers, or quotes. Do not say "breaking".
${cashtagRule}

Respond ONLY with JSON, no markdown: { "post_text": "..." }`;
}
