// Supplementary AI-story sources beyond RSS (discover worker).
//
// RSS alone under-feeds the `ai` vertical: ~half of AI ingest volume comes from
// primary-source product blogs (openai.com, huggingface.co) that no second
// outlet corroborates, so they die at the clusterer's >=2-distinct-domain gate.
// These two free, keyless APIs add BREADTH OF OUTLETS on the same AI events —
// the multi-outlet corroboration the clusterer is actually starving for — using
// real publisher URLs/domains (so URL canonicalisation and domain diversity work
// correctly, unlike Google News' encoded redirect URLs).
//
//   - Hacker News (Algolia search API): AI-filtered front-page stories. Real
//     external publisher URLs; points folded into a light authority signal.
//   - GDELT Doc 2.0 API: global news index, returns publisher url + domain
//     directly. English-filtered client-side; tightly queried to AI terms so it
//     doesn't flood scrape_queue.
//
// Both are tagged `ai` directly. The scraper's retagCategory() leaves an
// already-`ai` article untouched, so this stays consistent with the AI-retag
// path. Each source is isolated in its own try/catch: an upstream API outage
// degrades to zero supplementary candidates, never breaks RSS ingestion.
//
// Flag-gated; ON by default — set DISCOVER_API_SOURCES_ENABLED=false (or 0) in
// Azure to disable. Mirrors the AI_RETAG_ENABLED env-toggle pattern.

const API_TIMEOUT_MS = 10_000;
const CATEGORY        = "ai";

// HN Algolia — a few single-concept queries (Algolia ANDs multi-word queries,
// so we keep each query to one concept and dedup downstream via url_hash).
const HN_QUERIES = ["artificial intelligence", "OpenAI", "Anthropic", "LLM"];
const HN_HITS    = 30;   // per query

// GDELT — one OR'd AI query. Language is filtered on the returned `language`
// field (robust regardless of GDELT's query-token spelling for language).
const GDELT_QUERY = '(artificial intelligence OR OpenAI OR Anthropic OR ChatGPT OR "large language model")';
const GDELT_MAX   = 75;

function apiSourcesEnabled() {
  return !/^(0|false)$/i.test(String(process.env.DISCOVER_API_SOURCES_ENABLED ?? "true"));
}

// Registrable-ish host for diversity/dedup: hostname minus a leading "www.".
// Returns null on an unparseable URL so the caller can skip the item.
function domainFromUrl(rawUrl) {
  try {
    const h = new URL(rawUrl).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

// "YYYYMMDDTHHMMSSZ" (GDELT seendate) → ISO 8601, or null if unparseable.
function parseGdeltDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

// More upvotes ⇒ a slightly higher authority signal, bounded well under the
// primary-source labs so HN never dominates cluster scoring.
function hnAuthority(points) {
  const p = Number(points) || 0;
  if (p >= 300) return 0.6;
  if (p >= 100) return 0.4;
  return 0.3;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal:  AbortSignal.timeout(API_TIMEOUT_MS),
    headers: { "User-Agent": "quydly-discover/1.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ── Hacker News (Algolia) ─────────────────────────────────────────────────────
async function fetchHackerNews(context) {
  const out = [];
  for (const q of HN_QUERIES) {
    const url =
      `https://hn.algolia.com/api/v1/search_by_date?tags=story` +
      `&query=${encodeURIComponent(q)}&hitsPerPage=${HN_HITS}`;

    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      context.log.error(JSON.stringify({ event: "api_source_error", source: "hn", query: q, error: err.message }));
      continue; // one bad query shouldn't sink the others
    }

    for (const hit of data?.hits ?? []) {
      const rawUrl = hit?.url;
      if (!rawUrl) continue;                    // Ask/Show HN self-posts have no external url
      const domain = domainFromUrl(rawUrl);
      if (!domain || domain === "news.ycombinator.com") continue;

      out.push({
        rawUrl,
        domain,
        category_id:     CATEGORY,
        authority_score: hnAuthority(hit.points),
        published_at:    hit.created_at ?? null,
        title:           hit.title ?? null,
        summary:         null,
      });
    }
  }
  return out;
}

// ── GDELT Doc 2.0 ─────────────────────────────────────────────────────────────
async function fetchGdelt(context) {
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?format=json&mode=ArtList` +
    `&sort=DateDesc&maxrecords=${GDELT_MAX}&query=${encodeURIComponent(GDELT_QUERY)}`;

  let data;
  try {
    data = await fetchJson(url);
  } catch (err) {
    context.log.error(JSON.stringify({ event: "api_source_error", source: "gdelt", error: err.message }));
    return [];
  }

  const out = [];
  for (const art of data?.articles ?? []) {
    if (art?.language && art.language !== "English") continue; // English-only, client-side
    const rawUrl = art?.url;
    if (!rawUrl) continue;
    const domain = (art.domain ? String(art.domain) : domainFromUrl(rawUrl))?.toLowerCase();
    if (!domain) continue;
    const cleanDomain = domain.startsWith("www.") ? domain.slice(4) : domain;

    out.push({
      rawUrl,
      domain:          cleanDomain,
      category_id:     CATEGORY,
      authority_score: 0.3,                       // unknown outlet quality — keep modest
      published_at:    parseGdeltDate(art.seendate),
      title:           art.title ?? null,
      summary:         null,
    });
  }
  return out;
}

// Returns pre-canonicalisation raw candidates from all supplementary API
// sources: { rawUrl, domain, category_id, authority_score, published_at,
// title, summary }. The caller canonicalises + hashes uniformly. Never throws.
export async function fetchApiSourceCandidates(context) {
  if (!apiSourcesEnabled()) {
    context.log(JSON.stringify({ event: "api_sources_disabled" }));
    return [];
  }

  const results = await Promise.allSettled([
    fetchHackerNews(context),
    fetchGdelt(context),
  ]);

  const candidates = [];
  let hn_count = 0;
  let gdelt_count = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      candidates.push(...r.value);
      if (i === 0) hn_count = r.value.length;
      else gdelt_count = r.value.length;
    } else {
      context.log.error(JSON.stringify({ event: "api_source_failed", index: i, error: r.reason?.message }));
    }
  }

  context.log(JSON.stringify({ event: "api_sources_fetched", hn: hn_count, gdelt: gdelt_count }));
  return candidates;
}
