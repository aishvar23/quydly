// Source-link block for Instagram captions. Design §8.3 (attribution).
//
// Instagram captions are visual-first and historically carried NO source links
// (see instagram.js header). This module appends a small, curated "Sources"
// block to the IG caption DOWNSTREAM — after the deterministic/LLM body is built
// and after validation — so the validator never sees it, mirroring how the
// hashtag block is appended (see _hashtags.js / social-post-generator.js).
// IG-only: X forbids URLs entirely (social-validation.js) and never calls this.
//
//   sourceLinksFor(story, { max }) → ["https://a.com/x", "https://b.com/y"]
//   appendSourceLinks(text, story, opts) → caption + "\n\nSources:\n<url>\n<url>"
//
// URLs come from stories.source_documents (jsonb: [{ id, type, title, issuer,
// url, date, ... }], built by the synthesiser's buildSourceDocuments). Only
// public HTTPS article URLs are emitted; deduped, capped, best-effort — a story
// with no usable source URLs simply gets no block (never worse than the
// pre-feature caption).

import { CONSTRAINTS } from "./instagram.js";

// Keep the block short: a handful of links keeps the caption readable and the
// "Sources" block scannable. The synthesiser typically attaches 2–5 documents.
const DEFAULT_MAX_SOURCES = 3;

// Ordered, deduped list of public HTTPS source URLs for a story, capped at
// `max`. Reads stories.source_documents in persisted order (highest-authority
// first per the synthesiser). Non-HTTPS, blank, or duplicate URLs are dropped.
export function sourceLinksFor(story, { max = DEFAULT_MAX_SOURCES } = {}) {
  const docs = Array.isArray(story?.source_documents) ? story.source_documents : [];
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    if (out.length >= max) break;
    const url = typeof d?.url === "string" ? d.url.trim() : "";
    if (!/^https:\/\//i.test(url)) continue; // public HTTPS only — no http, no relative
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

// Append a "Sources:" block to a caption, separated by a blank line, staying
// within IG's caption cap. Adds as many whole URLs as fit (never splits a URL,
// never truncates the caption body); returns the caption unchanged if the
// header + even one URL would not fit. Cap defaults to instagram.js
// CONSTRAINTS.maxLength — the same limit the validator enforces on the body.
export function appendSourceLinks(text, story, opts = {}) {
  const max = opts.maxLength ?? CONSTRAINTS.maxLength;
  const body = String(text || "");
  const urls = sourceLinksFor(story, opts);
  if (!urls.length) return body;

  const header = "Sources:";
  const sep = body ? "\n\n" : "";
  // Greedily fit whole URLs (each on its own line under the header) under the cap.
  // fixed = body + separator + header; each URL adds "\n" + url.
  const fixed = body.length + sep.length + header.length;
  const fitted = [];
  let lineLen = 0;
  for (const url of urls) {
    const addition = 1 + url.length; // 1 = "\n" before each URL line
    if (fixed + lineLen + addition > max) break;
    fitted.push(url);
    lineLen += addition;
  }
  if (!fitted.length) return body;
  return `${body}${sep}${header}\n${fitted.join("\n")}`;
}
