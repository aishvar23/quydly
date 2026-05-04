// Azure Service Bus Function: story-synthesizer
// Trigger: synthesize-queue message
//
// Per-message: receives { cluster_id, category_id }, runs two-pass Claude API,
// applies quality gates, and upserts a story via the River model.
//
// Idempotency: if cluster.status !== 'PENDING' at entry, complete and return.
// Claude errors: throw — SB retries up to maxDeliveryCount=3 before dead-lettering.
//
// autoComplete: true (host.json) — return normally = complete, throw = abandon.
// Internal concurrency: p-limit(3) applied via host.json maxConcurrentCalls=8;
//   actual Claude concurrency is bounded by the 3 concurrent instances limit in
//   the synthesizer logic below (mirroring backend/engine/synthesizer.js).

import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "../lib/clients.js";
import { computeStoryScore, storyDisposition } from "../lib/scoring.js";
import { AUDIENCES, computeAudienceProjection } from "../lib/geo.js";
import { resolvePrimaryPlaces } from "../lib/places.js";
import { auditStory, persistAudit } from "../lib/storyAudit.js";
import { enrichNarrative, emptyEnrichment, enrichmentSucceeded } from "../lib/enrichment.js";
import { probeEntities } from "../lib/wikipedia.js";

const MODEL             = "claude-sonnet-4-20250514";
const MAX_RETRIES       = 2;
const CONTENT_TRUNCATE  = 500;
const RIVER_WINDOW_MS   = 24 * 60 * 60 * 1000;

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ── Claude passes (identical prompts to backend/engine/synthesizer.js) ────────

async function extractFacts(ai, articles) {
  const articleBlocks = articles
    .map((a, i) => {
      const body = [a.title, a.description, a.content ? a.content.slice(0, CONTENT_TRUNCATE) : null]
        .filter(Boolean)
        .join(" ");
      return `[Article ${i + 1} — ${a.domain}]\n${body}`;
    })
    .join("\n\n");

  const prompt = `You are a fact extractor for a news synthesis engine.

Extract key facts from these ${articles.length} articles about the same story.
For each fact, count how many articles mention or imply it (source_count).

${articleBlocks}

Respond ONLY with a valid JSON array, no markdown fences:
[
  { "fact": "...", "type": "event|statistic|quote|background", "source_count": <number> },
  ...
]

Rules:
- Extract 5–15 facts.
- type values: "event" (something happened), "statistic" (number/data point), "quote" (attributed statement), "background" (context).
- source_count = number of the above articles that mention or imply this fact.`;

  const msg = await ai.messages.create({
    model:      MODEL,
    max_tokens: 1024,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let facts;
  try {
    facts = JSON.parse(raw);
  } catch {
    throw new Error(`Pass 1 invalid JSON: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(facts)) throw new Error("Pass 1: expected a JSON array of facts");
  return facts;
}

async function generateNarrative(ai, cluster, facts) {
  const factsText = facts
    .map(f => `- [${f.type}] ${f.fact}  (sources: ${f.source_count})`)
    .join("\n");

  const prompt = `You are a news editor synthesising a story for a daily news quiz.

Topic entities: ${cluster.primary_entities.join(", ")}
Category: ${cluster.category_id}
Source articles: ${cluster.article_ids.length}

Extracted facts:
${factsText}

Respond ONLY with valid JSON, no markdown fences:
{
  "headline": "...",
  "summary": "...",
  "key_points": ["...", "...", "..."],
  "confidence_score": <number 1–10>
}

Rules:
- headline: declarative statement, 10–15 words, no question marks.
- summary: 2–3 factual sentences.
- key_points: exactly 3–5 strings, each one crisp takeaway from this story.
- confidence_score: 1 = speculation / single source, 10 = confirmed by multiple independent sources.`;

  const msg = await ai.messages.create({
    model:      MODEL,
    max_tokens: 1024,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`Pass 2 invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (
    typeof result.headline       !== "string" ||
    typeof result.summary        !== "string" ||
    !Array.isArray(result.key_points)          ||
    typeof result.confidence_score !== "number"
  ) {
    throw new Error(`Pass 2 missing required fields; got: ${Object.keys(result).join(", ")}`);
  }

  return result;
}

// ── Verbatim quote extraction (P0-2) ──────────────────────────────────────────
// Pass 3 of the synthesizer. Pulls 0-3 quotable statements from the article
// bodies, then verifies each is present *verbatim* in its claimed source
// article before we let it through. The video pipeline never invents quotes —
// paraphrasing real people is a trust violation — so support has to come from
// here or QuoteCard never fires.

const QUOTE_MAX_PER_STORY = 3;
const QUOTE_MIN_WORDS     = 4;
const QUOTE_MAX_CHARS     = 280;

// Normalise curly/straight quote drift and whitespace so the verbatim check
// tolerates the article's typesetting but still catches paraphrase. Keeps
// inner punctuation, casing, and word order — those are the real signals.
//
// IMPORTANT: do NOT strip apostrophes. Folding "we'll" → "well" lets a
// paraphrased quote silently pass the haystack.includes(needle) test, which
// would let unverified text reach QuoteCard. Curly variants are mapped to
// their straight counterparts instead so contractions survive intact.
function normaliseQuoteForCheck(s) {
  return String(s)
    .replace(/[“”]/g, '"')   // curly double → straight double
    .replace(/[‘’]/g, "'")   // curly single → straight apostrophe
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function articleBodyText(a) {
  return [a.title, a.description, a.content].filter(Boolean).join(" ");
}

export async function extractQuotes(ai, articles) {
  if (!articles || articles.length === 0) return [];

  const articleBlocks = articles
    .map((a, i) => {
      const body = [a.title, a.description, a.content ? a.content.slice(0, CONTENT_TRUNCATE) : null]
        .filter(Boolean)
        .join(" ");
      return `[Article ${i + 1} — ${a.domain}]\n${body}`;
    })
    .join("\n\n");

  const prompt = `You are a quote extractor for a news synthesis engine.

From these ${articles.length} articles, extract up to ${QUOTE_MAX_PER_STORY} verbatim
quotes. Each quote MUST appear word-for-word in the article body — do not
paraphrase, do not combine sentences, do not translate. Prefer quotes attributed
to a named person; skip wire-attribution boilerplate ("officials said").

${articleBlocks}

Respond ONLY with a valid JSON array, no markdown fences. Empty array if no
quotable statements exist:
[
  { "source_index": <1-based article number>, "text": "verbatim quote here", "speaker": "Name", "role": "their title or affiliation, or null" },
  ...
]

Rules:
- text: the quoted statement only. Do not include surrounding narrative.
- text length: between ${QUOTE_MIN_WORDS} words and ${QUOTE_MAX_CHARS} characters.
- speaker: required. If the article does not name a speaker, omit that quote.
- role: optional; null if not stated in the article.`;

  const msg = await ai.messages.create({
    model:      MODEL,
    max_tokens: 768,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let candidates;
  try {
    candidates = JSON.parse(raw);
  } catch {
    // Quote extraction is non-essential — never fail synthesis on a bad parse.
    return [];
  }
  if (!Array.isArray(candidates)) return [];

  const verified = [];
  for (const c of candidates) {
    if (verified.length >= QUOTE_MAX_PER_STORY) break;
    if (!c || typeof c.text !== "string" || typeof c.speaker !== "string") continue;
    if (!Number.isInteger(c.source_index) || c.source_index < 1 || c.source_index > articles.length) continue;
    if (c.text.length > QUOTE_MAX_CHARS) continue;
    if (c.text.trim().split(/\s+/).length < QUOTE_MIN_WORDS) continue;

    const article = articles[c.source_index - 1];
    const haystack = normaliseQuoteForCheck(articleBodyText(article));
    const needle   = normaliseQuoteForCheck(c.text);
    if (!haystack.includes(needle)) continue;

    verified.push({
      source_id: article.id,
      text:      c.text.trim(),
      speaker:   c.speaker.trim(),
      role:      typeof c.role === "string" && c.role.trim() ? c.role.trim() : null,
    });
  }
  return verified;
}

// ── Source-document snapshot (P0-1) ───────────────────────────────────────────
// Project article fields onto the story row at synthesis time so downstream
// consumers (video-pipeline-v2 EvidenceShelf, attribution chips) can render
// after raw_articles get retention-pruned.
//
// `verbatim_quotes` (optional) is the P0-2 output from the synthesis prompt;
// each quote is attached to whichever source_documents entry it was extracted
// from after passing the verbatim-presence guard.
//
// Output is sorted by authority desc with a stable id tiebreak. v2's
// EvidenceShelf and `sources[0]` citation pickers treat the first entry as
// the primary source, so leaving order to the database's row-return order
// would make attribution nondeterministic.
function compareSourceDocs(a, b) {
  const ax = Number.isFinite(a?.authority) ? a.authority : -Infinity;
  const bx = Number.isFinite(b?.authority) ? b.authority : -Infinity;
  if (ax !== bx) return bx - ax;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

export function buildSourceDocuments(articles, verbatimQuotes = []) {
  const docs = articles.map(a => ({
    id:             String(a.id),
    type:           "article",
    title:          a.title ?? null,
    issuer:         a.domain ?? null,
    url:            a.canonical_url ?? null,
    date:           a.published_at ?? null,
    authority:      Number(a.authority_score ?? 0),
    source_country: a.source_country ?? null,
  }));

  for (const q of verbatimQuotes) {
    if (q.source_id == null) continue;
    const target = docs.find(d => d.id === String(q.source_id));
    if (!target) continue;
    target.quote_text    = q.text;
    target.quote_speaker = q.speaker ?? null;
    target.quote_role    = q.role ?? null;
  }

  docs.sort(compareSourceDocs);
  return docs;
}

// Merge docs from a new synthesis into existing source_documents preserving
// previously-snapshotted entries (River-merged stories accrue evidence over
// time as new clusters land). Dedupe by id, then re-sort by authority desc
// so the primary-citation slot stays deterministic across merges.
export function mergeSourceDocuments(existing, incoming) {
  const byId = new Map();
  for (const d of Array.isArray(existing) ? existing : []) {
    if (d && d.id != null) byId.set(String(d.id), d);
  }
  for (const d of incoming) {
    if (!d || d.id == null) continue;
    byId.set(String(d.id), { ...(byId.get(String(d.id)) ?? {}), ...d });
  }
  return [...byId.values()].sort(compareSourceDocs);
}

// Telemetry helper for the enrichment log line — total count of numeric
// extractions across the structured_numbers buckets, for at-a-glance lift.
function countNumbers(structured) {
  if (!structured || typeof structured !== "object") return 0;
  return ["money", "counts", "percentages", "magnitudes", "casualties"]
    .reduce((acc, key) => acc + (Array.isArray(structured[key]) ? structured[key].length : 0), 0);
}

// Build the enrichment-column subset of an UPDATE/INSERT payload.
//
// Returns `{}` (no enrichment columns) when the LLM enrichment pass did not
// succeed. The empty object is critical: spread into the writer's payload, it
// causes the columns to be omitted entirely. On UPDATE that preserves any
// previously-enriched values on the row; on INSERT the migration's column
// defaults take over (NULL for the four text columns, `{}`/`[]` for jsonb).
//
// Per Codex P1 review on PR #71: previously this function unconditionally
// emitted column values even when `enrichment` was the `emptyEnrichment()`
// fallback, which on River-merge let a transient enrichment LLM failure reset
// `story_type='general'` and clear structured fields on already-enriched
// stories. Gating on `enrichmentSucceeded` removes that data regression.
function buildEnrichmentColumns(enrichment, enrichedEntities) {
  if (!enrichmentSucceeded(enrichment)) return {};
  return {
    story_type:                enrichment.story_type,
    editorial_posture:         enrichment.editorial_posture,
    hook_sentence:             enrichment.hook_sentence,
    why_it_matters:            enrichment.why_it_matters,
    structured_numbers:        enrichment.structured_numbers,
    timeline_events:           enrichment.timeline_events,
    primary_entities_enriched: enrichedEntities,
  };
}

// ── Wikipedia attach (P0-4) ───────────────────────────────────────────────────
// Probe Wikipedia REST for each enriched entity and stitch the metadata onto
// the entity object. Stays out of band of synthesis: any per-entity error
// degrades to `resolved: false` (the probe utility never throws), and a
// global failure of probeEntities only loses the metadata for this run —
// the entity is still written with the synthesizer-supplied name/type/role.
//
// `existingContext` survives if the LLM enrichment already wrote a context
// line (e.g. from article quotes); the Wikipedia summary fills in only when
// the enriched entry lacks its own context.
export async function attachWikipediaToEntities(entities, { signal } = {}) {
  if (!Array.isArray(entities) || entities.length === 0) return [];

  const names = entities.map(e => e?.name).filter(Boolean);
  let probes;
  try {
    probes = await probeEntities(names, { signal });
  } catch {
    return entities.map(e => ({ ...e, wiki_resolved: false, wiki_reason: "probe_failed" }));
  }

  let probeIdx = 0;
  return entities.map(e => {
    if (!e?.name) return e;
    const probe = probes[probeIdx++];
    if (!probe) return e;
    if (probe.resolved) {
      return {
        ...e,
        wikipedia_url:           probe.wikipedia_url ?? null,
        wikipedia_thumbnail_url: probe.wikipedia_thumbnail_url ?? null,
        wikipedia_summary:       probe.wikipedia_summary ?? null,
        wikipedia_title:         probe.wikipedia_title ?? null,
        image_license:           probe.image_license ?? null,
        wiki_resolved:           true,
        // Synthesizer-supplied context wins; Wikipedia summary fills only when blank.
        context: e.context ?? probe.wikipedia_summary ?? null,
      };
    }
    return {
      ...e,
      wiki_resolved: false,
      wiki_reason:   probe.reason ?? "unknown",
    };
  });
}

// ── Global significance score (design §7.2) ───────────────────────────────────

function computeGlobalSignificance(cluster, synthesis, articles) {
  const uniqueDomains = Math.min(6, (cluster.unique_domains ?? []).length);
  const allMentionedGeos = new Set();
  for (const a of articles) {
    for (const g of a.mentioned_geos ?? []) allMentionedGeos.add(g);
  }
  const geoDiversity = Math.min(5, allMentionedGeos.size);
  const maxAuthority = articles.reduce(
    (max, a) => Math.max(max, Number(a.authority_score ?? 0)),
    0,
  );
  return Number((
    2 * uniqueDomains +
    3 * geoDiversity +
    2 * maxAuthority +
    2 * synthesis.confidence_score
  ).toFixed(2));
}

// ── River model: find existing story to merge ─────────────────────────────────

async function findExistingStory(supabase, cluster, riverCutoff) {
  // Strategy 1: same cluster_id
  const { data: byCluster, error: e1 } = await supabase
    .from("stories")
    .select("id, primary_entities, key_points, source_documents, updated_at")
    .eq("cluster_id", cluster.id)
    .gte("updated_at", riverCutoff)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e1) {
    throw new Error(`river lookup (cluster_id): ${e1.message}`);
  }
  if (byCluster) return byCluster;

  // Strategy 2: entity overlap in same category
  const { data: candidates, error: e2 } = await supabase
    .from("stories")
    .select("id, primary_entities, key_points, source_documents, updated_at")
    .eq("category_id", cluster.category_id)
    .gte("updated_at", riverCutoff)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (e2) {
    throw new Error(`river lookup (entity overlap): ${e2.message}`);
  }
  if (!candidates || candidates.length === 0) return null;

  let best = null, bestOverlap = 0;
  for (const story of candidates) {
    const storyEntities = Array.isArray(story.primary_entities) ? story.primary_entities : [];
    const overlap = cluster.primary_entities.filter(e => storyEntities.includes(e)).length;
    if (overlap >= 2 && overlap > bestOverlap) {
      best        = story;
      bestOverlap = overlap;
    }
  }

  return best;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function storySynthesizer(context, message) {
  const { cluster_id } = message;

  const supabase = getSupabase();
  const ai       = getAnthropic();

  // ── 1. Fetch cluster — idempotency check ─────────────────────────────────
  const { data: cluster, error: clusterErr } = await supabase
    .from("clusters")
    .select("id, category_id, primary_entities, article_ids, unique_domains, cluster_score, status, primary_geos, geo_scores, source_countries")
    .eq("id", cluster_id)
    .single();

  if (clusterErr) {
    throw new Error(`[story-synthesizer] fetch cluster ${cluster_id}: ${clusterErr.message}`);
  }

  if (!cluster || cluster.status !== "PENDING") {
    // Already processed by a prior or duplicate message — complete and return.
    context.log(JSON.stringify({
      event:      "cluster_not_pending",
      cluster_id,
      status:     cluster?.status ?? "not_found",
    }));
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // ── 2. Mark PROCESSING so concurrent duplicates see non-PENDING ──────────
  await supabase
    .from("clusters")
    .update({ status: "PROCESSING", updated_at: new Date().toISOString() })
    .eq("id", cluster_id);

  // ── 3. Fetch article content ──────────────────────────────────────────────
  // canonical_url / published_at / author are needed in addition to NLP fields
  // because we snapshot a source_documents projection onto the story row (P0-1).
  const { data: articles, error: artErr } = await supabase
    .from("raw_articles")
    .select("id, title, description, content, domain, canonical_url, published_at, author, mentioned_geos, source_country, geo_scores, authority_score")
    .in("id", cluster.article_ids);

  if (artErr) {
    // Reset to PENDING — next SB retry can try again
    await supabase
      .from("clusters")
      .update({ status: "PENDING", updated_at: new Date().toISOString() })
      .eq("id", cluster_id);
    throw new Error(`[story-synthesizer] fetch articles for cluster ${cluster_id}: ${artErr.message}`);
  }

  if (!articles || articles.length === 0) {
    context.log.warn(JSON.stringify({ event: "no_articles", cluster_id }));
    await supabase
      .from("clusters")
      .update({ status: "PROCESSED", updated_at: new Date().toISOString() })
      .eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // ── 4a. Phase A: Claude API calls (with retry) ────────────────────────────
  let facts, narrative, lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      facts     = await extractFacts(ai, articles);
      narrative = await generateNarrative(ai, cluster, facts);
      lastErr   = null;
      break;
    } catch (err) {
      lastErr = err;
      context.log.error(JSON.stringify({
        event:      "synthesis_attempt_failed",
        cluster_id,
        attempt,
        error:      err.message,
      }));
    }
  }

  if (lastErr) {
    // All retries exhausted — throw so SB retries (up to maxDeliveryCount=3)
    throw lastErr;
  }

  // P0-2: verbatim quote extraction. Non-essential pass — if Claude fails or
  // the response can't be verified, we proceed with no quotes rather than
  // killing the synthesis. QuoteCard simply won't fire for this story.
  let verbatimQuotes = [];
  try {
    verbatimQuotes = await extractQuotes(ai, articles);
  } catch (err) {
    context.log.warn(JSON.stringify({
      event:      "quote_extraction_failed",
      cluster_id,
      error:      err.message,
    }));
  }

  // P0-5 + P1 batch: enrichment pass produces story_type / editorial_posture /
  // hook_sentence / why_it_matters / structured_numbers / timeline_events /
  // primary_entities_enriched. Self-contained against failure — defaults out
  // to an empty enrichment shape so the story still writes.
  let enrichment = emptyEnrichment();
  try {
    enrichment = await enrichNarrative(ai, cluster, articles, narrative);
  } catch (err) {
    context.log.warn(JSON.stringify({
      event:      "enrichment_failed",
      cluster_id,
      error:      err.message,
    }));
  }

  // P0-4: Wikipedia probe for each enriched entity. Fills in image URL +
  // summary so video-pipeline-v2 can render DossierCard / MapCallout without
  // making render-time API calls. Honours the strict-title-match guard inside
  // probeEntities — a wrong-target page is recorded as resolved=false, not
  // attached as if it were the right photo.
  const enrichedEntities = await attachWikipediaToEntities(
    enrichment.primary_entities_enriched,
  );

  context.log(JSON.stringify({
    event:                  "enrichment_completed",
    cluster_id,
    story_type:             enrichment.story_type,
    editorial_posture:      enrichment.editorial_posture,
    hook_present:           Boolean(enrichment.hook_sentence),
    why_it_matters_present: Boolean(enrichment.why_it_matters),
    structured_numbers_count: countNumbers(enrichment.structured_numbers),
    timeline_events_count:  enrichment.timeline_events.length,
    entities_count:         enrichedEntities.length,
    entities_resolved:      enrichedEntities.filter(e => e.wiki_resolved).length,
  }));

  // ── 4b. Phase B: quality gates + River lookup + DB write ─────────────────
  const now = new Date().toISOString();

  // Quality gate: confidence
  if (narrative.confidence_score < 6) {
    context.log(JSON.stringify({ event: "LOW_CONFIDENCE", cluster_id, confidence: narrative.confidence_score }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Quality gate: key_points completeness
  if (narrative.key_points.length < 3) {
    context.log(JSON.stringify({ event: "LOW_KEY_POINTS", cluster_id, count: narrative.key_points.length }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Scoring
  const synthesisResult = { ...narrative, facts };
  const { story_score, consistency_score, source_count } = computeStoryScore(cluster, synthesisResult);
  const disposition = storyDisposition(story_score);

  if (disposition === "reject") {
    context.log(JSON.stringify({ event: "LOW_STORY_SCORE", cluster_id, story_score, disposition }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Geo metadata for story
  const globalSignificanceScore = computeGlobalSignificance(cluster, narrative, articles);
  const storyPrimaryGeos = cluster.primary_geos ?? [];
  const storyGeoScores   = cluster.geo_scores   ?? {};
  const storyPrimaryPlaces = resolvePrimaryPlaces(storyPrimaryGeos);

  // Extras for computeAudienceProjection (india_article_fraction requires article-level data)
  const indianArticleCount    = articles.filter(a => a.source_country === "in").length;
  const indianArticleFraction = articles.length > 0 ? indianArticleCount / articles.length : 0;

  // P0-1 + P0-2: snapshot source documents from the cluster's articles, with
  // any verified verbatim quotes attached to the originating doc.
  const incomingSourceDocs = buildSourceDocuments(articles, verbatimQuotes);

  context.log(JSON.stringify({
    event:           "source_documents_snapshot",
    cluster_id,
    document_count:  incomingSourceDocs.length,
    quote_count:     verbatimQuotes.length,
  }));

  // River model: find or create story — Step 2 of processing contract
  const riverCutoff   = new Date(Date.now() - RIVER_WINDOW_MS).toISOString();
  const existingStory = await findExistingStory(supabase, cluster, riverCutoff);

  let story_id;

  if (existingStory) {
    const existingPoints  = Array.isArray(existingStory.key_points) ? existingStory.key_points : [];
    const mergedKeyPoints = [...new Set([...existingPoints, ...narrative.key_points])].slice(0, 10);
    const mergedSourceDocs = mergeSourceDocuments(existingStory.source_documents, incomingSourceDocs);

    const { error: updateErr } = await supabase
      .from("stories")
      .update({
        primary_entities:          cluster.primary_entities,
        headline:                  narrative.headline,
        summary:                   narrative.summary,
        key_points:                mergedKeyPoints,
        confidence_score:          narrative.confidence_score,
        story_score,
        consistency_score,
        source_count,
        primary_geos:              storyPrimaryGeos,
        primary_places:            storyPrimaryPlaces,
        geo_scores:                storyGeoScores,
        global_significance_score: globalSignificanceScore,
        source_documents:          mergedSourceDocs,
        // P0-5 / P1 enrichment fields. Spread is empty (no columns touched)
        // when the enrichment pass fell back to defaults — see
        // buildEnrichmentColumns. Successful runs overwrite; failed runs
        // leave the previously-persisted enrichment intact.
        ...buildEnrichmentColumns(enrichment, enrichedEntities),
        updated_at:                now,
      })
      .eq("id", existingStory.id);

    if (updateErr) throw new Error(`story update: ${updateErr.message}`);

    story_id = existingStory.id;
    context.log(JSON.stringify({ event: "story_merged", cluster_id, story_id, story_score, disposition, global_significance_score: globalSignificanceScore }));
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("stories")
      .insert({
        cluster_id,
        category_id:               cluster.category_id,
        primary_entities:          cluster.primary_entities,
        headline:                  narrative.headline,
        summary:                   narrative.summary,
        key_points:                narrative.key_points,
        confidence_score:          narrative.confidence_score,
        story_score,
        consistency_score,
        source_count,
        primary_geos:              storyPrimaryGeos,
        primary_places:            storyPrimaryPlaces,
        geo_scores:                storyGeoScores,
        global_significance_score: globalSignificanceScore,
        source_documents:          incomingSourceDocs,
        // P0-5 / P1 enrichment fields. On a failed enrichment pass, the
        // spread is empty and Supabase falls back to the migration's column
        // defaults: NULL for the four text columns, `{}` / `[]` for jsonb.
        // NULL is the honest "we didn't enrich this row" signal — distinct
        // from a successful enrichment that genuinely picked story_type
        // 'general'.
        ...buildEnrichmentColumns(enrichment, enrichedEntities),
        is_verified:               false,
        published_at:              now,
        updated_at:                now,
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(`story insert: ${insertErr.message}`);

    story_id = inserted.id;
    context.log(JSON.stringify({ event: "story_written", cluster_id, story_id, story_score, disposition, global_significance_score: globalSignificanceScore }));
  }

  // ── Step 3: upsert story_audiences for every configured audience ──────────
  // Must succeed before PROCESSED is written — this is the commit point boundary.
  const projectionStory = {
    global_significance_score: globalSignificanceScore,
    primary_geos: storyPrimaryGeos,
  };
  const projectionExtras = { indian_article_fraction: indianArticleFraction };

  for (const audience of AUDIENCES) {
    const projection = computeAudienceProjection(projectionStory, cluster, audience, projectionExtras);

    const { error: audErr } = await supabase
      .from("story_audiences")
      .upsert(
        {
          story_id,
          audience_geo:    audience,
          relevance_score: projection.relevance_score,
          rank_bucket:     projection.rank_bucket,
          rank_priority:   projection.rank_priority,
          reason:          projection.reason,
          updated_at:      now,
        },
        { onConflict: "story_id,audience_geo" },
      );

    if (audErr) {
      // Reset to PENDING so SB redelivery can retry — cluster must not stay
      // stuck in PROCESSING after a partial audience write.
      await supabase
        .from("clusters")
        .update({ status: "PENDING", updated_at: now })
        .eq("id", cluster_id);
      throw new Error(`story_audiences upsert (${audience}): ${audErr.message}`);
    }

    context.log(JSON.stringify({
      event:           "story_audience_projected",
      story_id,
      audience_geo:    audience,
      rank_bucket:     projection.rank_bucket,
      rank_priority:   projection.rank_priority,
      relevance_score: projection.relevance_score,
      reason:          projection.reason,
    }));
  }

  // ── Step 5: Quality audit — non-blocking; PROCESSED still written on failure ─
  try {
    const auditResult = await auditStory(
      {
        headline:         narrative.headline,
        summary:          narrative.summary,
        key_points:       narrative.key_points,
        confidence_score: narrative.confidence_score,
        source_count,
      },
      facts,
    );
    await persistAudit(supabase, story_id, auditResult, now);
    context.log(JSON.stringify({
      event:          "story_audited",
      story_id,
      quiz_candidate: auditResult.quiz_candidate,
      decision:       auditResult.decision,
      flags:          auditResult.quality_flags,
      reason:         auditResult.reason,
    }));
  } catch (err) {
    context.log.error(JSON.stringify({ event: "audit_failed", story_id, error: err.message }));
  }

  // ── Step 6: Mark cluster PROCESSED — commit point (must be last DB write) ─
  // autoComplete: true (host.json) — returning normally completes the SB message.
  await supabase
    .from("clusters")
    .update({ status: "PROCESSED", updated_at: now })
    .eq("id", cluster_id);
}
