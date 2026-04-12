// Phase 5.1 — Article scraper
// Fetches a URL, extracts article content via @mozilla/readability.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { hashUrl } from "../utils/canonicalise.js";

const FETCH_TIMEOUT_MS = 15_000;
const MIN_CONTENT_LENGTH = 200;

export async function scrapeArticle(canonical_url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html;
  try {
    const res = await fetch(canonical_url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; QuydlyBot/1.0; +https://quydly.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();

  if (!article) {
    return { status: "LOW_QUALITY", reason: "readability_failed" };
  }

  const content = article.textContent?.trim() ?? "";
  if (content.length < MIN_CONTENT_LENGTH) {
    return {
      status: "LOW_QUALITY",
      reason: "too_short",
      title: article.title,
      description: article.excerpt,
      content,
    };
  }

  const content_hash = hashUrl(content); // SHA256 reused for content fingerprint

  return {
    status: "DONE",
    title: article.title,
    description: article.excerpt,
    content,
    content_hash,
    author: article.byline ?? null,
  };
}
