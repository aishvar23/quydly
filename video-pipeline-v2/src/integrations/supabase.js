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
  storyId,                        // exact id match — bypasses floor filters
  minId,                          // id >= minId
  random = true,
} = {}) {
  const supabase = getClient();
  let query = supabase
    .from('stories')
    .select(
      'id, cluster_id, category_id, primary_entities, primary_geos, primary_places, ' +
      'headline, summary, key_points, confidence_score, coherence_score, ' +
      'consistency_score, ' +
      'support_score, story_score, source_count, is_verified, published_at, ' +
      'source_documents, ' +
      // P1-8 / P1-9 / P1-10 — surface the data-quality columns the renderer
      // can use to honestly attribute, gate, and adjudicate. NULL on rows
      // synthesised before the migration; storyRowToFixture handles that.
      'source_diversity_score, source_diversity_label, ' +
      'verification_status, verification_notes, corrections, ' +
      'factual_conflicts, ' +
      // Bridge phase 1 — synth-side editorial fields v2 had been ignoring.
      // hook_sentence (P1-2) is the spoken-word hook the synth tuned for
      // the first 3 seconds. why_it_matters (P1-7) is the stakes line.
      // editorial_posture (P1-3) is the closed-set classification used to
      // pick chips ('breaking_developing', 'tally_official', etc.).
      // primary_entities_enriched (P1-4 + P0-4) is the proper-cased
      // [{name, type, role, context, wikipedia_*}] list — distinguishes
      // person/place/org so we don't frame "Iran vs India" when Iran is
      // a place and US is a place that happens to be missing from
      // primary_geos. structured_numbers (P1-1) is the dedup'd
      // money/counts/percentages/casualties payload.
      'hook_sentence, why_it_matters, editorial_posture, story_type, ' +
      'primary_entities_enriched, structured_numbers, ' +
      // P1-5 + P3-4 — synth-extracted timeline events with labels.
      // The brief pairs the dates here with deduped key_points when
      // timeline_disposition indicates the LLM extraction was thin
      // ("fallback") so the renderer still gets a multi-day chronology.
      'timeline_events, timeline_disposition',
    );

  // Exact-id targeting bypasses verification + audit-floor filters so the
  // editor can render any specific story without first promoting it.
  if (storyId != null) {
    const { data, error } = await query.eq('id', storyId).limit(1);
    if (error) throw new Error(`Supabase fetch stories: ${error.message}`);
    return data || [];
  }

  query = query
    .eq('is_verified', isVerified)
    .gte('story_score', scoreFloor)
    .gte('confidence_score', confidenceFloor)
    .gte('coherence_score', coherenceFloor)
    .gte('support_score', supportFloor);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (minId != null) query = query.gte('id', minId);

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
    // consistency_score is the synth's per-story validator output
    // (azure-functions/lib/scoring.js), distinct from coherence_score.
    // Bridge phase 1 reads it for the publishability gate.
    consistency_score: row.consistency_score ?? 0,
    support_score: row.support_score ?? 0,
    story_score: row.story_score ?? 0,
    source_count: row.source_count ?? (resolvedSourceDocs.length || 0),
    is_verified: Boolean(row.is_verified),
    primary_entities: Array.isArray(row.primary_entities) ? row.primary_entities : [],
    primary_geos: readableGeos(row),
    // Bridge phase 1 — pass through the rich [{code, name}] shape so
    // deriveAngle can match place names against the hook_sentence.
    // The simpler `primary_geos` array of name strings stays as the
    // back-compat consumer for older module builders.
    primary_places: Array.isArray(row.primary_places) ? row.primary_places : [],
    published_at: row.published_at || new Date().toISOString(),
    source_documents: resolvedSourceDocs,
    // P1-8: weighted source-diversity score plus its 'single|narrow|diverse'
    // bucketing, so EvidenceShelf can pick honest attribution copy
    // ("Sourced from 3 independent outlets" vs "Single-source coverage").
    // Null on pre-migration rows — modules must fall back gracefully.
    source_diversity_score: typeof row.source_diversity_score === 'number'
      ? row.source_diversity_score
      : null,
    source_diversity_label: row.source_diversity_label ?? null,
    // P1-9: verification lifecycle. Pre-migration rows carry no field;
    // the migration backfills 'verified' for is_verified=true and 'draft'
    // otherwise, so a non-null value here is always interpretable.
    // Renderer policy ("don't render below verified") layers on top.
    verification_status: row.verification_status ?? null,
    verification_notes: row.verification_notes ?? null,
    corrections: Array.isArray(row.corrections) ? row.corrections : [],
    // P1-10: per-story factual conflicts. Empty array on rows with no
    // detected divergence — distinct from pre-migration null. Modules can
    // render "DOJ says $8B; NYT says $10B" or hide the figure until
    // editor reconciles.
    factual_conflicts: Array.isArray(row.factual_conflicts) ? row.factual_conflicts : [],
    // Bridge phase 1: editorial fields the v2 modules will start reading.
    hook_sentence:    row.hook_sentence    ?? null,
    why_it_matters:   row.why_it_matters   ?? null,
    editorial_posture: row.editorial_posture ?? null,
    story_type:       row.story_type       ?? null,
    primary_entities_enriched: Array.isArray(row.primary_entities_enriched)
      ? row.primary_entities_enriched
      : [],
    structured_numbers: row.structured_numbers ?? null,
    timeline_events: Array.isArray(row.timeline_events) ? row.timeline_events : [],
    timeline_disposition: typeof row.timeline_disposition === 'string'
      ? row.timeline_disposition
      : null,
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
