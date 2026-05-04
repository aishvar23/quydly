// Wikipedia entity pre-resolver (P0-4 of data-pipeline-improvements-tracker).
//
// Purpose: at synthesis time, probe the Wikipedia REST API for each named
// entity and store the metadata inline on the story row. Downstream renderers
// (video-pipeline-v2 DossierCard / MapCallout) then carry deterministic image
// data without making API calls at render time.
//
// Differs from `video-pipeline-v2/src/integrations/wikimedia.js` deliberately:
//   - This module does NOT download images. It only stores the thumbnail URL,
//     summary, and source-page URL. The renderer can fetch the image when it
//     actually needs to composite it.
//   - The output shape is a flat metadata object suited for inline JSON
//     storage on the story row, not a render-side asset record.
//
// Trust model: the v2 wikimedia integration learned the hard way that the
// Wikipedia REST API will silently follow redirects and serve the lead image
// of a related-but-wrong page (e.g. "Gannon Ken Van Dyke" → US Special Ops
// Command). We mirror its two-line defence:
//   1. `redirect=false` so 30x responses are visible and refused
//   2. Strict token-match between query name and returned page title
// Failing either, we record `{ resolved: false, reason }` so the story still
// carries an entity entry but the renderer can decide whether to fall back.

import { setTimeout as sleep } from "node:timers/promises";

const REST_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const USER_AGENT   = "Quydly/0.1 (https://quydly.com; pipeline@quydly.com)";

// Fetch tuning. Wikipedia REST is generally fast but occasionally rate-limits
// bursty parallel access. The synthesizer hits this once per entity per
// cluster (≤ ~6 entities), so a small concurrency cap is enough to stay polite.
const FETCH_TIMEOUT_MS = 8000;
const MAX_RETRIES      = 2;
const RETRY_BASE_MS    = 400;

// Process-lifetime memo. A single Function App instance synthesises many
// clusters; popular entities (politicians, agencies) recur across clusters
// in a day. Caching the resolved metadata for the lifetime of the process
// pays for itself in the first repeat.
const memCache = new Map();

// Failure reasons safe to cache — they reflect the state of Wikipedia, not
// transient network conditions, so re-trying within the same process is a
// waste. Anything NOT on this list (network_error, http_5xx, invalid_json,
// http_4xx-other-than-404) is treated as transient and never memoised, so
// a flicker doesn't lock the entity out for the rest of the process.
//
// Per Codex P2 review on PR #71.
const PERMANENT_FAILURE_REASONS = new Set([
  "empty_name",         // input never had a chance to resolve — repeat call would behave identically
  "not_found",          // 404 from Wikipedia REST
  "redirect_refused",   // page is a redirect we deliberately don't follow
  "disambiguation",     // page is a disambig listing
  "title_mismatch",     // returned page title doesn't match query tokens
]);

function shouldCache(result) {
  if (result?.resolved === true) return true;
  return PERMANENT_FAILURE_REASONS.has(result?.reason);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Probe Wikipedia for a single named entity. Returns a metadata object whether
 * or not the lookup succeeded — callers should store the result inline on the
 * entity even when `resolved: false`, so that `quality_flags` and downstream
 * fallbacks know an attempt was made.
 *
 * @param {string} name        Display name as the synthesizer stored it.
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]  External cancellation (e.g. from host shutdown).
 * @returns {Promise<{
 *   resolved: boolean,
 *   reason?: string,
 *   wikipedia_url?: string,
 *   wikipedia_thumbnail_url?: string,
 *   wikipedia_summary?: string,
 *   wikipedia_title?: string,
 *   image_license?: string,
 * }>}
 */
export async function probeEntityWikipedia(name, { signal } = {}) {
  if (!name || typeof name !== "string") {
    return { resolved: false, reason: "empty_name" };
  }
  const trimmed = name.trim();
  if (!trimmed) return { resolved: false, reason: "empty_name" };

  const cacheKey = trimmed.toLowerCase();
  if (memCache.has(cacheKey)) return memCache.get(cacheKey);

  const result = await lookupSummary(trimmed, signal);
  // Only memoise stable outcomes — transient failures (network, 5xx, parse)
  // must remain retry-eligible on the next probe. See PERMANENT_FAILURE_REASONS.
  if (shouldCache(result)) memCache.set(cacheKey, result);
  return result;
}

/**
 * Probe Wikipedia for a list of entities in bounded parallelism. Order of the
 * returned array matches the input order. Per-entity errors degrade to
 * `{ resolved: false, reason }` rather than rejecting — the synthesizer must
 * never fail because of a Wikipedia hiccup.
 *
 * @param {Array<string>} names
 * @param {object} [opts]
 * @param {number}      [opts.concurrency=3]
 * @param {AbortSignal} [opts.signal]
 */
export async function probeEntities(names, { concurrency = 3, signal } = {}) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const results = new Array(names.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, names.length)) }, async () => {
    while (cursor < names.length) {
      const i = cursor++;
      try {
        results[i] = await probeEntityWikipedia(names[i], { signal });
      } catch (err) {
        results[i] = { resolved: false, reason: "unexpected_error", error: err?.message ?? String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// Test hook — clears the in-process memo so unit tests don't bleed into each
// other. Not exported in production paths.
export function _resetCache() {
  memCache.clear();
}

// ── Implementation ────────────────────────────────────────────────────────────

async function lookupSummary(name, signal) {
  // `redirect=false` is critical. Without it the REST API silently follows
  // 30x redirects and returns the destination page's image — which can be
  // arbitrarily different from what we asked about. The v2 integration
  // documents the "Gannon Ken Van Dyke → US Special Ops" incident; we
  // inherit the same guard here.
  const url = REST_SUMMARY + encodeURIComponent(name.replace(/\s+/g, "_")) + "?redirect=false";

  let resp;
  try {
    resp = await fetchWithRetry(url, signal);
  } catch (err) {
    return { resolved: false, reason: "network_error", error: err?.message ?? String(err) };
  }

  if (resp.status === 404) {
    return { resolved: false, reason: "not_found" };
  }
  if (resp.status === 301 || resp.status === 302) {
    // Page is a redirect and we asked not to follow. Treat as a non-match —
    // the redirected article may be unrelated to the query.
    return { resolved: false, reason: "redirect_refused" };
  }
  if (!resp.ok) {
    return { resolved: false, reason: `http_${resp.status}` };
  }

  let summary;
  try {
    summary = await resp.json();
  } catch (err) {
    return { resolved: false, reason: "invalid_json", error: err?.message ?? String(err) };
  }

  if (summary?.type === "disambiguation") {
    return { resolved: false, reason: "disambiguation" };
  }

  // Strict title-match: even with redirect=false the API can occasionally
  // return a page with a different-but-related title. Every meaningful token
  // of the query name must appear in the returned title (case- and
  // diacritic-insensitive). Refuse otherwise — better to drop the photo than
  // to attribute a real photo to the wrong subject.
  if (!titleMatchesName(summary?.title, name)) {
    return { resolved: false, reason: "title_mismatch", wikipedia_title: summary?.title ?? null };
  }

  const thumbUrl  = summary?.thumbnail?.source ?? null;
  const pageUrl   =
    summary?.content_urls?.desktop?.page ??
    `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/\s+/g, "_"))}`;
  const extract   = typeof summary?.extract === "string" ? summary.extract.trim() : null;
  const wikiTitle = summary?.title ?? null;

  return {
    resolved:                true,
    wikipedia_title:         wikiTitle,
    wikipedia_url:           pageUrl,
    wikipedia_thumbnail_url: thumbUrl,
    wikipedia_summary:       extract,
    // The summary endpoint doesn't return per-image license, but the standard
    // attribution path is to credit the source page. CC-BY-SA + public-domain
    // images live behind the same URL, so the chip text is the same in both
    // cases. Renderers should always show the page link as the credit.
    image_license:           "Wikipedia: see source page",
  };
}

async function fetchWithRetry(url, signal) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error("aborted");
    }
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        headers:  { "User-Agent": USER_AGENT, Accept: "application/json" },
        // Without manual mode, fetch silently follows 30x and we lose the
        // chance to refuse a redirected page.
        redirect: "manual",
        signal:   ctrl.signal,
      });
      // 5xx is retryable; 4xx (incl. 404) is not.
      if (resp.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = new Error(`http_${resp.status}`);
      } else {
        return resp;
      }
    } catch (err) {
      lastErr = err;
      if (err?.name === "AbortError" && signal?.aborted) throw err;
      if (attempt >= MAX_RETRIES) throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    // Exponential backoff with jitter — keeps us polite under transient 5xx.
    await sleep(RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 100));
  }
  throw lastErr ?? new Error("fetch_exhausted");
}

// Token-overlap title match. Every meaningful token of the query name must
// appear in the article title (case-insensitive, diacritic-folded). The
// article title MAY contain extra words ("Sam Bankman-Fried" matches
// "Samuel Bankman-Fried"), but a missing query token is a hard fail.
function titleMatchesName(articleTitle, queryName) {
  if (!articleTitle || !queryName) return false;
  const normalize = (s) =>
    String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")  // strip combining marks → "Reykjavík" → "reykjavik"
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const articleTokens = new Set(
    normalize(articleTitle).split(/[\s-]+/).filter((t) => t.length >= 2),
  );
  const queryTokens = normalize(queryName).split(/[\s-]+/).filter((t) => t.length >= 2);
  if (queryTokens.length === 0) return false;
  return queryTokens.every((t) => articleTokens.has(t));
}
