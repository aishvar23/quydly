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

import { rootDomain } from "./sourceDiversity.js";

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

// Registrable-ish domain root for diversity/dedup. Routes the URL host through
// the SAME rootDomain() the synthesizer's diversity layer uses, so an
// API-sourced "edition.cnn.com" / "in.reuters.com" collapses to the same value
// an RSS row would carry — otherwise the clusterer's >=2-distinct-domain gate
// (which counts the raw stored domain) would treat one outlet as two and
// falsely inflate corroboration. Returns null on an unparseable URL.
function domainFromUrl(rawUrl) {
  try {
    return rootDomain(new URL(rawUrl).hostname);
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
async function fetchHnQuery(context, q) {
  const url =
    `https://hn.algolia.com/api/v1/search_by_date?tags=story` +
    `&query=${encodeURIComponent(q)}&hitsPerPage=${HN_HITS}`;

  let data;
  try {
    data = await fetchJson(url);
  } catch (err) {
    context.log.error(JSON.stringify({ event: "api_source_error", source: "hn", query: q, error: err.message }));
    return []; // one bad query shouldn't sink the others
  }

  const out = [];
  for (const hit of data?.hits ?? []) {
    const rawUrl = hit?.url;
    if (!rawUrl) continue;                    // Ask/Show HN self-posts have no external url
    const domain = domainFromUrl(rawUrl);
    if (!domain || domain === "ycombinator.com") continue;

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
  return out;
}

// The queries are independent, so fan them out concurrently rather than serially
// (a serial loop adds up to HN_QUERIES × API_TIMEOUT_MS of blocking wall-clock).
async function fetchHackerNews(context) {
  const settled = await Promise.allSettled(HN_QUERIES.map(q => fetchHnQuery(context, q)));
  return settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));
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
    // English-only, client-side. Require the field to be present and "English"
    // (rather than "exclude only when explicitly non-English") so records with a
    // missing/variant language tag don't slip into AI clusters.
    if (art?.language !== "English") continue;
    const rawUrl = art?.url;
    if (!rawUrl) continue;
    // Prefer GDELT's own domain field, else derive from the URL — both through
    // rootDomain() for consistency with RSS rows and the diversity layer.
    const domain = art.domain ? rootDomain(String(art.domain)) : domainFromUrl(rawUrl);
    if (!domain) continue;

    out.push({
      rawUrl,
      domain,
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

  // name-keyed so per-source counts stay correct as sources are added/reordered.
  const sources = [
    { name: "hn",    fetch: fetchHackerNews },
    { name: "gdelt", fetch: fetchGdelt },
  ];

  const settled = await Promise.allSettled(sources.map(s => s.fetch(context)));

  const candidates = [];
  const counts = {};
  settled.forEach((r, i) => {
    const name = sources[i].name;
    if (r.status === "fulfilled") {
      candidates.push(...r.value);
      counts[name] = r.value.length;
    } else {
      counts[name] = 0;
      context.log.error(JSON.stringify({ event: "api_source_failed", source: name, error: r.reason?.message }));
    }
  });

  context.log(JSON.stringify({ event: "api_sources_fetched", ...counts }));
  return candidates;
}
