'use strict';

const { createClient } = require('@supabase/supabase-js');

// Lazy Supabase client with service-role auth. Read SUPABASE_URL +
// SUPABASE_SERVICE_KEY from process.env (loaded via dotenv in CLI entry).
let cached = null;
function getClient() {
  if (cached) return cached;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  }
  cached = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } },
  );
  return cached;
}

// Country code → readable proper-case name. Supabase's `primary_geos` stores
// ISO 3166-1 alpha-2 codes (e.g. "in"); the v2 fixture wants readable names
// the gazetteer / forwardGeocode can resolve.
//
// Source: GEO_ALIASES.aliases[0] from azure-functions/lib/geo.js. Manually
// transcribed (rather than imported) to keep v2 free of an azure-functions
// dependency. Add codes here as fixtures need them.
const COUNTRY_CODE_TO_NAME = {
  in: 'India',
  pk: 'Pakistan',
  bd: 'Bangladesh',
  lk: 'Sri Lanka',
  np: 'Nepal',
  cn: 'China',
  jp: 'Japan',
  kr: 'South Korea',
  kp: 'North Korea',
  tw: 'Taiwan',
  hk: 'Hong Kong',
  sg: 'Singapore',
  my: 'Malaysia',
  id: 'Indonesia',
  ph: 'Philippines',
  th: 'Thailand',
  vn: 'Vietnam',
  us: 'United States',
  ca: 'Canada',
  mx: 'Mexico',
  br: 'Brazil',
  ar: 'Argentina',
  ve: 'Venezuela',
  co: 'Colombia',
  cl: 'Chile',
  pe: 'Peru',
  gb: 'United Kingdom',
  uk: 'United Kingdom',
  ie: 'Ireland',
  fr: 'France',
  de: 'Germany',
  it: 'Italy',
  es: 'Spain',
  pt: 'Portugal',
  nl: 'Netherlands',
  be: 'Belgium',
  ch: 'Switzerland',
  at: 'Austria',
  pl: 'Poland',
  se: 'Sweden',
  no: 'Norway',
  dk: 'Denmark',
  fi: 'Finland',
  is: 'Iceland',
  gr: 'Greece',
  tr: 'Turkey',
  ru: 'Russia',
  ua: 'Ukraine',
  by: 'Belarus',
  ro: 'Romania',
  cz: 'Czech Republic',
  hu: 'Hungary',
  il: 'Israel',
  ps: 'Palestinian Territories',
  ir: 'Iran',
  sa: 'Saudi Arabia',
  ae: 'United Arab Emirates',
  qa: 'Qatar',
  eg: 'Egypt',
  za: 'South Africa',
  ng: 'Nigeria',
  ke: 'Kenya',
  et: 'Ethiopia',
  au: 'Australia',
  nz: 'New Zealand',
};

function geoCodeToName(code) {
  if (!code || typeof code !== 'string') return null;
  return COUNTRY_CODE_TO_NAME[code.trim().toLowerCase()] || null;
}

// Fetch up to N stories. Defaults to is_verified=true and a story_score
// floor so the batch reflects the working production filter, not raw drafts.
// `random` shuffles via ORDER BY random() (Postgres-side); fine for our
// table sizes.
async function fetchStories({
  count = 10,
  isVerified = true,
  scoreFloor = 0,
  // Match validateStory()'s thresholds so the rows we pull won't get
  // immediately rejected by the audit step. Tweak only if you're hunting
  // a specific story that sits below these.
  coherenceFloor = 0.65,
  supportFloor = 0.65,
  confidenceFloor = 5,
  categoryId,
  random = true,
} = {}) {
  const supabase = getClient();
  let query = supabase
    .from('stories')
    .select(
      'id, cluster_id, category_id, primary_entities, primary_geos, primary_places, ' +
      'headline, summary, key_points, confidence_score, coherence_score, ' +
      'support_score, story_score, source_count, is_verified, published_at, ' +
      'source_documents',
    )
    .eq('is_verified', isVerified)
    .gte('story_score', scoreFloor)
    .gte('confidence_score', confidenceFloor)
    .gte('coherence_score', coherenceFloor)
    .gte('support_score', supportFloor);
  if (categoryId) query = query.eq('category_id', categoryId);

  // Postgres random() ordering is fine at our story-count scale (10s of
  // thousands). For large tables, switch to TABLESAMPLE.
  if (random) {
    // Supabase JS doesn't expose .order('random()') directly — overfetch
    // and shuffle client-side instead. Costs an extra DB row each but
    // doesn't require raw SQL.
    query = query
      .order('story_score', { ascending: false })
      .limit(Math.max(count * 5, 50));
  } else {
    query = query
      .order('story_score', { ascending: false })
      .limit(count);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Supabase fetch stories: ${error.message}`);
  let rows = data || [];

  if (random) {
    // Fisher-Yates over the overfetched pool, take first N.
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    rows = rows.slice(0, count);
  }

  return rows;
}

// Fetch raw_articles for a story's cluster. Returns the rows in
// authority_score-desc order so the highest-credibility source leads the
// resulting source_documents array. Empty array on miss / error.
async function fetchSourceArticles(clusterId, limitArticles = 4) {
  if (!clusterId) return [];
  const supabase = getClient();
  const { data: cluster, error: cErr } = await supabase
    .from('clusters')
    .select('article_ids')
    .eq('id', clusterId)
    .single();
  if (cErr || !cluster?.article_ids?.length) return [];

  const { data: articles, error: aErr } = await supabase
    .from('raw_articles')
    .select('id, canonical_url, domain, title, author, published_at, authority_score')
    .in('id', cluster.article_ids)
    .order('authority_score', { ascending: false })
    .limit(limitArticles);
  if (aErr) {
    console.warn(`[supabase] raw_articles fetch failed for cluster ${clusterId}: ${aErr.message}`);
    return [];
  }
  return articles || [];
}

// Build fixture-shape source_documents from raw_articles. Verbatim quotes
// are absent in the pipeline data — QuoteCard will skip cleanly.
function articlesToSourceDocs(articles) {
  return (articles || []).map((a) => ({
    id: `raw-${a.id}`,
    type: 'news article',
    title: a.title || '',
    issuer: a.domain || '',
    url: a.canonical_url || '',
    date: formatPublishedAt(a.published_at),
  }));
}

// Normalise source_documents that the synthesizer wrote inline on the story
// row (P0-1) into the fixture shape the v2 renderer expects. Quotes (P0-2)
// pass through onto QuoteCard. Older stories without inline source_documents
// fall through to the raw_articles fetch path in fetchSourceArticles.
function snapshotToSourceDocs(snapshot) {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map((d) => {
    const out = {
      id: `raw-${d.id ?? ''}`,
      type: d.type || 'news article',
      title: d.title || '',
      issuer: d.issuer || '',
      url: d.url || '',
      date: formatPublishedAt(d.date),
    };
    if (d.quote_text) {
      out.quote_text = d.quote_text;
      out.quote_speaker = d.quote_speaker || '';
      out.quote_role = d.quote_role || '';
    }
    return out;
  });
}

function formatPublishedAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const months = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch (_) {
    return '';
  }
}

// Translate Supabase `primary_geos` (lowercase ISO codes) to readable names.
// Codes that don't translate are dropped — the v2 audit blocks unknown
// regions earlier than the renderer would.
function translateGeos(codes) {
  if (!Array.isArray(codes)) return [];
  return codes
    .map((c) => geoCodeToName(c))
    .filter(Boolean);
}

// Prefer the synthesizer-resolved `primary_places` (P0-3) when present —
// names land at synthesis time so the gazetteer translation here is no
// longer the source of truth. Older stories fall back to translateGeos.
function readableGeos(row) {
  const places = Array.isArray(row?.primary_places) ? row.primary_places : [];
  const fromPlaces = places.map((p) => p?.name).filter(Boolean);
  if (fromPlaces.length > 0) return fromPlaces;
  return translateGeos(row?.primary_geos);
}

// Convert a Supabase story row + its source articles into a fixture-shape
// object the v2 pipeline can consume. Prefers fields the synthesizer now
// snapshots inline (P0-1 source_documents, P0-3 primary_places) and falls
// back to fetched raw_articles + the local geo gazetteer for older rows.
function storyRowToFixture(row, sourceDocs) {
  const inlineSnapshot = Array.isArray(row.source_documents) ? row.source_documents : [];
  const resolvedSourceDocs = inlineSnapshot.length > 0
    ? snapshotToSourceDocs(inlineSnapshot)
    : (sourceDocs || []);

  return {
    id: String(row.id),
    category_id: row.category_id,
    headline: row.headline,
    summary: row.summary,
    key_points: Array.isArray(row.key_points) ? row.key_points : [],
    confidence_score: row.confidence_score ?? 0,
    coherence_score: row.coherence_score ?? 0,
    support_score: row.support_score ?? 0,
    story_score: row.story_score ?? 0,
    source_count: row.source_count ?? (resolvedSourceDocs.length || 0),
    is_verified: Boolean(row.is_verified),
    primary_entities: Array.isArray(row.primary_entities) ? row.primary_entities : [],
    primary_geos: readableGeos(row),
    published_at: row.published_at || new Date().toISOString(),
    source_documents: resolvedSourceDocs,
  };
}

module.exports = {
  getClient,
  fetchStories,
  fetchSourceArticles,
  articlesToSourceDocs,
  snapshotToSourceDocs,
  storyRowToFixture,
  translateGeos,
  readableGeos,
  geoCodeToName,
};
