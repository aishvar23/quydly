'use strict';

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./http');

// Wikipedia REST API entity-photo fetcher.
// Returns CC-BY-SA / public-domain real photos of named subjects with
// structured attribution we can render as a credit chip. Fits the
// evidence-first stance: real photos of the actual person/place, not
// AI-generated faces or unrelated stock.
//
// Endpoint: en.wikipedia.org/api/rest_v1/page/summary/{title}
// → { title, thumbnail: { source, width, height }, originalimage,
//     content_urls: { desktop: { page } }, ... }
//
// License attribution: the summary endpoint doesn't include per-image
// license, but standard practice is to credit "Wikipedia: <Title>" with
// link back to the source page. CC-BY-SA technically requires author
// credit; we surface the page URL which is the canonical attribution path.

const REST_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const USER_AGENT = 'Quydly/0.1 (https://quydly.com; pipeline@quydly.com)';

// In-process cache so a single batch run that hits the same person ten
// times only pays once.
const memCache = new Map();

async function fetchEntityImage(name, kind = 'person', { outputDir, targetWidth = 800 } = {}) {
  if (!name || typeof name !== 'string') {
    return { ok: false, reason: 'empty_name', hint: 'No entity name supplied' };
  }
  const cacheKey = `${kind}:${name.toLowerCase()}`;
  if (memCache.has(cacheKey)) {
    const cached = memCache.get(cacheKey);
    // Re-copy the cached image to this run's outputDir so render-props
    // can reference it under the run's assets/ directory.
    if (cached.ok && outputDir && cached._sourceBuffer) {
      const localPath = writeBuffer(outputDir, name, cached._ext, cached._sourceBuffer);
      return { ...cached, path: localPath };
    }
    return cached;
  }

  // ── 1. Summary lookup ───────────────────────────────────────────────────
  // `redirect=false` is critical: without it Wikipedia silently follows
  // redirects and returns whatever lead image the redirected article has.
  // That gave us Trump's situation-room photo for "Gannon Ken Van Dyke".
  // Strict-match titles after fetch as a second line of defence.
  const summaryUrl = REST_SUMMARY + encodeURIComponent(name.replace(/\s+/g, '_')) + '?redirect=false';
  let summary;
  try {
    const resp = await fetchWithRetry(summaryUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      // Without manual mode, Node fetch silently follows 30x and we never
      // see the redirect — losing our chance to refuse a wrong-target page.
      redirect: 'manual',
    });
    if (resp.status === 404) {
      const result = { ok: false, reason: 'wikipedia_404', hint: `No Wikipedia page for "${name}"` };
      memCache.set(cacheKey, result);
      return result;
    }
    if (resp.status === 302 || resp.status === 301) {
      // The REST API returns 30x when the page is a redirect and we asked
      // not to follow. Treat as no exact match — refuse to serve the
      // redirected page's image because it's not what we asked for.
      const result = { ok: false, reason: 'wikipedia_redirect', hint: `"${name}" redirects on Wikipedia; refusing to serve a possibly-wrong image` };
      memCache.set(cacheKey, result);
      return result;
    }
    if (!resp.ok) {
      const result = { ok: false, reason: `wikipedia_http_${resp.status}`, hint: `Wikipedia returned HTTP ${resp.status} for "${name}"` };
      memCache.set(cacheKey, result);
      return result;
    }
    summary = await resp.json();
  } catch (error) {
    const result = { ok: false, reason: 'wikipedia_network', hint: `Network error fetching "${name}": ${error.message}` };
    memCache.set(cacheKey, result);
    return result;
  }

  // Disambiguation pages have no thumbnail and a "type":"disambiguation"
  if (summary.type === 'disambiguation') {
    const result = { ok: false, reason: 'disambiguation', hint: `"${name}" is a Wikipedia disambiguation page; needs more specific entity name` };
    memCache.set(cacheKey, result);
    return result;
  }

  // Strict title-match: even with redirect=false, the API can sometimes
  // serve a different-but-related article. Compare normalized titles —
  // every token of the queried name must appear in the response title.
  // This catches "Gannon Ken Van Dyke" → "United States Special
  // Operations" silent matches, and anything that produces a wildly
  // different title from what we asked for.
  if (!titleMatchesName(summary.title, name)) {
    const result = {
      ok: false,
      reason: 'title_mismatch',
      hint: `Wikipedia returned page "${summary.title}" for query "${name}" — refusing to serve a possibly-wrong image`,
    };
    memCache.set(cacheKey, result);
    return result;
  }

  if (!summary.thumbnail?.source) {
    const result = { ok: false, reason: 'no_thumbnail', hint: `Wikipedia page "${summary.title}" has no thumbnail image` };
    memCache.set(cacheKey, result);
    return result;
  }

  // ── 2. Pick best resolution ─────────────────────────────────────────────
  // Wikipedia thumbnails follow a sized URL pattern. Swap to targetWidth.
  const sourceUrl = widenThumbnail(summary.thumbnail.source, targetWidth);

  let buffer;
  try {
    const resp = await fetchWithRetry(sourceUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) {
      const result = { ok: false, reason: `image_http_${resp.status}`, hint: `Failed to download image: HTTP ${resp.status}` };
      memCache.set(cacheKey, result);
      return result;
    }
    buffer = Buffer.from(await resp.arrayBuffer());
  } catch (error) {
    const result = { ok: false, reason: 'image_network', hint: `Network error downloading image: ${error.message}` };
    memCache.set(cacheKey, result);
    return result;
  }

  // ── 3. Determine extension and write to disk ────────────────────────────
  const urlPath = new URL(sourceUrl).pathname;
  let ext = path.extname(urlPath).toLowerCase();
  if (!/\.(jpg|jpeg|png|webp)$/i.test(ext)) {
    // SVG and other formats don't render reliably in Remotion <Img>.
    // We only download from the thumbnail endpoint which is always raster,
    // so this is mostly a safety net.
    const result = { ok: false, reason: 'unsupported_format', hint: `Image format "${ext}" not supported` };
    memCache.set(cacheKey, result);
    return result;
  }

  let localPath = null;
  if (outputDir) {
    localPath = writeBuffer(outputDir, name, ext, buffer);
  }

  const result = {
    ok: true,
    path: localPath,
    sourceUrl: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/\s+/g, '_'))}`,
    credit: `Wikipedia: ${summary.title}`,
    license: 'CC-BY-SA / public domain (per source page)',
    attribution: summary.title,
    entityName: name,
    kind,
    width: summary.thumbnail.width || null,
    height: summary.thumbnail.height || null,
    // Cache the raw buffer so a repeat call to the same name during one
    // process write-copies into a different outputDir without re-fetching.
    _sourceBuffer: buffer,
    _ext: ext,
  };
  memCache.set(cacheKey, result);
  return result;
}

// Strict-ish title match. Every meaningful token of the queried name
// must appear in the article title (case-insensitive). Tokens shorter
// than 2 chars are ignored (initials, short particles). Article title
// MAY contain extra words ("Sam Bankman-Fried" matches "Samuel
// Bankman-Fried") but ALL of the user-supplied tokens must be present,
// so a query for "Gannon Ken Van Dyke" will not match an article titled
// "United States Special Operations Command".
function titleMatchesName(articleTitle, queryName) {
  if (!articleTitle || !queryName) return false;
  // NFD-decompose and strip combining marks so "Reykjavík" → "reykjavik".
  // Without this, a diacritic in the article title creates a false negative
  // for unaccented user queries.
  const normalize = (s) => String(s).toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const articleTokens = new Set(
    normalize(articleTitle).split(/[\s-]+/).filter((t) => t.length >= 2),
  );
  const queryTokens = normalize(queryName).split(/[\s-]+/).filter((t) => t.length >= 2);
  if (queryTokens.length === 0) return false;
  return queryTokens.every((t) => articleTokens.has(t));
}

// "https://upload.wikimedia.org/.../thumb/.../320px-Kash_Patel.jpg"
//   → "https://upload.wikimedia.org/.../thumb/.../800px-Kash_Patel.jpg"
function widenThumbnail(url, targetWidth) {
  return String(url).replace(/\/(\d+)px-/, `/${targetWidth}px-`);
}

function writeBuffer(outputDir, name, ext, buffer) {
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const filename = `entity-${slugify(name)}${ext}`;
  const out = path.join(assetsDir, filename);
  fs.writeFileSync(out, buffer);
  return out;
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

module.exports = {
  fetchEntityImage,
};
