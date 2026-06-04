// Post text validation. Design §10.4.
//
// Enforces the concrete, checkable subset of the §10.4 rules on a generated post
// before it is saved. Anything that fails is rejected so the orchestrator can
// fall back to the deterministic draft (which is built only from story facts).
//
//   validatePost({ platform, text, story, constraints }) → { valid, errors }
//
// Note: media presence is NOT validated here — Instagram drafts are allowed to
// exist without an asset; the publisher (Phase 4) enforces "media before publish".

import { weightedLength } from "./platforms/x.js";
import { cashtagsFor } from "./platforms/_cashtags.js";

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

// A $cashtag token: '$' + 1–6 letters, optional class suffix (e.g. $BRK.B).
// Requires a leading letter so dollar amounts ("$5") are NOT matched.
const CASHTAG_RE = /\$[A-Za-z]{1,6}(?:\.[A-Za-z])?/g;

// Numbers that are part of fixed brand/CTA phrasing, not factual claims.
const WHITELISTED_NUMBERS = new Set(["5"]); // "5-question quiz"

function normaliseNumbers(text) {
  const matches = String(text || "").match(NUMBER_RE) || [];
  return matches.map((m) => m.replace(/,/g, ""));
}

function storyFactBlob(story) {
  const parts = [story.headline, story.summary];
  const kp = story.key_points;
  if (Array.isArray(kp)) {
    for (const p of kp) parts.push(typeof p === "string" ? p : (p && (p.text || p.point)) || "");
  }
  return parts.filter(Boolean).join(" ");
}

export function validatePost({ platform, text, story, constraints }) {
  const errors = [];
  const value = String(text || "").trim();

  if (!value) {
    return { valid: false, errors: ["empty post text"] };
  }

  // Length. X enforces a URL-weighted limit (each link counts as 23 chars), so
  // measure X posts the way X does; other platforms use raw length.
  const measured = platform === "x" ? weightedLength(value) : value.length;
  if (constraints && measured > constraints.maxLength) {
    errors.push(`exceeds ${platform} max length ${constraints.maxLength} (got ${measured})`);
  }

  // CTA must be present. X posts use an engagement CTA ("…full quiz is in our
  // bio", no link, to drive replies + profile visits); other platforms link to
  // Quydly.
  if (platform === "x") {
    if (!/\bbio\b/i.test(value)) errors.push("missing 'in our bio' CTA");
  } else if (!/quydly/i.test(value)) {
    errors.push("missing Quydly CTA");
  }

  // X posts must carry NO URL — a link raises X API cost. (Other platforms may
  // link to quydly.com.) Reject any http(s) link or bare quydly.com.
  if (platform === "x" && /(https?:\/\/|\bquydly\.com\b)/i.test(value)) {
    errors.push("X post must not include a URL/link");
  }

  // Hashtags are disallowed when the platform opts out (X, and IG before the
  // curated block is appended downstream). Cashtags ($AAPL) use '$' and are a
  // separate, allowed token, so match '#' specifically. A negative lookbehind
  // catches a tag wherever it starts — at the start, after whitespace, OR
  // adjacent to punctuation like "(#trending)" or ".#trending" — while a '#'
  // that follows a word char (a URL fragment such as page#section) is left alone.
  if (constraints && constraints.allowHashtags === false && /(?<!\w)#\w/.test(value)) {
    errors.push(`${platform} post must not include hashtags`);
  }

  // Cashtags must be exactly the curated set for this story — LLM copy could
  // otherwise emit a plausible-but-wrong ticker (e.g. $TSLA for an Nvidia story),
  // sending readers to the wrong ticker page, which is what the curation avoids.
  // A non-finance story has an empty set, so any $cashtag is rejected there.
  if (constraints && constraints.allowCashtags) {
    const allowed = new Set(cashtagsFor(story).map((c) => c.toUpperCase()));
    for (const tag of value.match(CASHTAG_RE) || []) {
      if (!allowed.has(tag.toUpperCase())) {
        errors.push(`unexpected cashtag "${tag}"`);
      }
    }
  }

  // No "breaking" unless story was just updated — we have no reliable freshness
  // signal at post level, so forbid it outright in MVP.
  if (/\bbreaking\b/i.test(value)) {
    errors.push('uses "breaking"');
  }

  // No "sources say" unless multi-source support exists.
  if (/\bsources?\b/i.test(value) && (Number(story.source_count) || 0) < 2) {
    errors.push('references "sources" without multi-source support');
  }

  // No unsupported numbers: every number in the post must appear in the story
  // facts (or be a whitelisted brand number). Line-leading list ordinals
  // ("1. ", "2) ") are not factual claims, so strip them first.
  const claimText = value.replace(/^[ \t]*\d+[.)][ \t]+/gm, "");
  const allowed = new Set([...normaliseNumbers(storyFactBlob(story)), ...WHITELISTED_NUMBERS]);
  for (const n of normaliseNumbers(claimText)) {
    if (!allowed.has(n)) {
      errors.push(`unsupported number "${n}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}
