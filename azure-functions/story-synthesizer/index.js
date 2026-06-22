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
import { isSpecificNamedEntity } from "../lib/nlp.js";
import FLAGS from "../lib/flags.js";
import { AUDIENCES, computeAudienceProjection, countryCodeForPlaceName } from "../lib/geo.js";
import { resolvePrimaryPlaces } from "../lib/places.js";
import { auditStory, persistAudit } from "../lib/storyAudit.js";
import { enrichNarrative, emptyEnrichment, enrichmentSucceeded } from "../lib/enrichment.js";
import { probeEntities } from "../lib/wikipedia.js";
import { lookupPortraitOverrides } from "../lib/portraitOverrides.js";
import { computeSourceDiversity } from "../lib/sourceDiversity.js";
import { computeVideoEligibility } from "../lib/videoEligibility.js";
import { computeStoryDecayAt } from "../lib/freshness.js";
import { aggregateArticleLanguages } from "../lib/languageDetection.js";

const MODEL             = "claude-sonnet-4-6";
const MAX_RETRIES       = 2;
const CONTENT_TRUNCATE  = 500;
const RIVER_WINDOW_MS   = 24 * 60 * 60 * 1000;
// Lease window for the PROCESSING claim. A cluster left in PROCESSING longer
// than this is presumed to belong to a dead invocation (function killed mid
// synthesis) and may be reclaimed by a redelivery. Set ABOVE the 10-min
// functionTimeout (host.json) so a still-running invocation is always either
// finished or already killed by the host before its lease is judged stale —
// an in-flight invocation can never be reclaimed out from under itself, which
// is what guarantees no two messages synthesise the same cluster. The bounded
// Anthropic client (60s timeout, 2 retries) keeps real syntheses to ~2-3 min,
// far inside the window; the prompt's "10 min" wedge threshold is satisfied
// for any cluster a dead invocation left behind (those rows are minutes-to-
// hours stale).
const PROCESSING_LEASE_MS = 15 * 60 * 1000;

// Per-category synthesis gate resolution. Mirrors article-clusterer's
// minSharedEntitiesFor(): look up the category-specific value, fall back to
// `default`. Thresholds themselves live in lib/flags.js (project rule: pipeline
// scoring knobs in azure-functions/lib/flags.js only). A null/unknown category
// resolves to `default`, so non-AI verticals are untouched.
const SYNTH = FLAGS.synthesis;
function synthThreshold(group, categoryId) {
  return group[categoryId] ?? group.default;
}

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) {
    // Bound every Anthropic call: a per-request 60s timeout + 2 SDK retries.
    // Without this the SDK can hang indefinitely on a stalled connection,
    // which collided with the 5-min function timeout + 5-min SB lock and left
    // clusters wedged in PROCESSING (2026-06-15 16:01 incident root cause).
    _anthropic = new Anthropic({
      apiKey:     process.env.ANTHROPIC_API_KEY,
      timeout:    60_000,
      maxRetries: 2,
    });
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

// P3-2 — tail-pattern guard for verbatim quotes. The verbatim check (P0-2)
// only ensures the candidate appears word-for-word in the article body; it
// does nothing about *where* in the body. The synthesizer truncates each
// article to CONTENT_TRUNCATE chars before showing the LLM, which can split
// mid-sentence — and the LLM happily emits the leading fragment as a
// "quote". Story 170's Ghalibaf line is the canonical case:
//   "A full ceasefire only makes sense if it is not violated by the naval blockade and"
// Verbatim, but obviously incomplete. Reject any quote that ends in a word
// signalling more sentence to come, or in a non-terminal character.
const QUOTE_TAIL_BLOCKLIST = new Set([
  // Coordinating conjunctions
  "and", "but", "or", "nor", "yet", "so",
  // Articles
  "the", "a", "an",
  // Common prepositions that strongly imply "more clause to come"
  "of", "to", "for", "in", "on", "at", "with", "by", "as", "from", "into", "onto",
  "about", "against", "among", "around", "before", "between", "during",
  "through", "toward", "towards", "under", "until", "upon", "within", "without",
  // Subordinators
  "that", "which", "who", "whom", "whose", "because", "since", "while", "when", "where",
  // Auxiliaries that need a complement
  "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had",
  "will", "would", "shall", "should", "may", "might", "must", "can", "could",
]);

const QUOTE_TERMINAL_CHARS = new Set(['.', '!', '?', '"', "'", '”', '’', '…']);

// Returns true when the candidate text ends in a way that signals a complete
// utterance: terminal punctuation, OR a word that doesn't appear in the
// blocklist of "more sentence to come" markers. False = reject.
export function quoteHasCompleteTail(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Terminal punctuation is the strongest signal — accept regardless of last word.
  const lastChar = trimmed[trimmed.length - 1];
  if (QUOTE_TERMINAL_CHARS.has(lastChar)) return true;

  // No terminal punctuation → check the final word. Strip trailing punctuation
  // (commas, semicolons, parens) so "blockade," still resolves to "blockade".
  const lastWord = trimmed
    .split(/\s+/)
    .pop()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+$/u, "");
  if (!lastWord) return false;
  return !QUOTE_TAIL_BLOCKLIST.has(lastWord);
}

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
- text MUST be a complete utterance — end in terminal punctuation (. ! ? " ') or
  at least at a word that doesn't leave the sentence dangling. Do not emit a
  fragment that ends in "and", "but", "the", "of", "to", "is", "was", etc.
  If the article was truncated mid-sentence, skip that quote rather than
  emitting the leading fragment.
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
    // P3-2: reject mid-clause / truncated tails.
    if (!quoteHasCompleteTail(c.text)) continue;

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

// P4-1 — quote fields use a tri-state convention so River-merge can tell
// "no quote this run" (CLEAR) from "this synth didn't touch quotes" (PRESERVE):
//   explicit null   → clear any previously-stored quote on this doc
//   absent (undef)  → preserve whatever the prior synthesis stored
//   string value    → set / overwrite
// Without this, P3-2's tail validator rejects a quote at extraction time,
// but the old quote_text from a prior synth survives the merge — story 170
// validation showed exactly this happen with the truncated Ghalibaf quote.
const QUOTE_FIELDS = ["quote_text", "quote_speaker", "quote_role"];

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
    // 2026-05-09: persist the byline so source-diversity can detect
    // same-author concentration across articles, and so the v2 video
    // pipeline's stage-2 gate-2a (≥75% of source_documents share one
    // author) can actually fire — previously the field was fetched but
    // dropped here, leaving the gate unable to read it from the row.
    // Story 215 (4 articles, 3 by Justin Kahn across 9to5 sister sites)
    // is the documented incident.
    author:         a.author ?? null,
    // P4-1: explicit null = "this synth verified no quote on this doc".
    // Set unconditionally; loop below overwrites with strings when a
    // quote attaches.
    quote_text:    null,
    quote_speaker: null,
    quote_role:    null,
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
//
// P4-1 — quote-field semantics: when the incoming doc carries an explicit
// `quote_text: null`, treat that as "this synth ran the validator and
// rejected", and CLEAR the corresponding quote_speaker / quote_role on the
// merged result. Without this, a stale quote that the new validator rejects
// would survive the merge — story 170 had exactly this with the Ghalibaf
// quote ending in "...and".
export function mergeSourceDocuments(existing, incoming) {
  const byId = new Map();
  for (const d of Array.isArray(existing) ? existing : []) {
    if (d && d.id != null) byId.set(String(d.id), d);
  }
  for (const d of incoming) {
    if (!d || d.id == null) continue;
    const prior = byId.get(String(d.id)) ?? {};
    const merged = { ...prior, ...d };
    // P4-1: if the incoming doc explicitly declared no quote (quote_text
    // present and null), wipe all quote fields on the merged result. Don't
    // wipe when quote_text is undefined — that means the caller didn't
    // touch quotes and we should preserve.
    if (Object.prototype.hasOwnProperty.call(d, "quote_text") && d.quote_text == null) {
      for (const f of QUOTE_FIELDS) merged[f] = null;
    }
    byId.set(String(d.id), merged);
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

// P3-5 — rewrite the legacy `primary_entities text[]` column from the
// clean enriched names at synth time. The cluster-level array is dirty
// in ~every story ("correspondent", "washington", "two india", "hormuz
// the") because the clusterer's regex-based entity extraction can't tell
// noise from signal. The enriched jsonb has been clean since P1-4 — but
// any consumer still reading `primary_entities` (River-merge entity
// overlap, the question generator) operates on the dirty array.
//
// Strategy: when enrichment succeeded, use enrichedEntities[*].name as
// the source of truth. When enrichment failed (rare — LLM blip), fall
// back to the dirty cluster array so we don't write an empty list and
// regress entity-overlap matching for the next River-merge attempt.
const PRIMARY_ENTITIES_CAP = 10;

export function cleanPrimaryEntities(enrichedEntities, clusterEntities) {
  // Codex P2 fix on PR #80: gate fallback on whether enrichment RAN
  // (input non-empty), not on whether the cleaned output is non-empty.
  // sanitiseEntities already drops invalid items; if enrichment ran
  // successfully and somehow yielded no usable names, falling back to
  // the dirty cluster array would resurrect noise the validator
  // explicitly rejected. Empty-but-validated wins over dirty-but-full.
  if (Array.isArray(enrichedEntities) && enrichedEntities.length > 0) {
    const out = [];
    const seen = new Set();
    for (const e of enrichedEntities) {
      if (typeof e?.name !== "string") continue;
      const name = e.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= PRIMARY_ENTITIES_CAP) break;
    }
    return out;
  }
  return Array.isArray(clusterEntities) ? clusterEntities : [];
}

// P3-1 — augment cluster-aggregated primary_geos with country codes derived
// from synthesizer-tagged places. The synthesis LLM has already identified
// each `primary_entities_enriched[*]` of type "place" as central to the
// story — that's editorial-strength signal that the cluster-level mention
// rollup may have missed (e.g. when an article uses a city name not yet
// in the gazetteer). Entity-derived codes are PREPENDED so the strongest
// editorial signal lands at index 0 (drives MapCallout); cluster codes
// follow in their existing rank order. Output is deduped and capped.
const STORY_PRIMARY_GEO_CAP = 5;

export function mergeEntityAndClusterGeos(clusterPrimaryGeos, enrichedEntities) {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(enrichedEntities) ? enrichedEntities : []) {
    if (e?.type !== "place") continue;
    const code = countryCodeForPlaceName(e.name);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  for (const code of Array.isArray(clusterPrimaryGeos) ? clusterPrimaryGeos : []) {
    if (typeof code !== "string" || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.slice(0, STORY_PRIMARY_GEO_CAP);
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
    // P3-4: disposition reflects whether the LLM produced a healthy
    // multi-day timeline, fell back to article-date derivation, or
    // collapsed to one date. Stored as a column so the renderer can
    // suppress TimelineCard on `single_day` / `absent` without re-deriving.
    timeline_disposition:      enrichment.timeline_disposition,
    primary_entities_enriched: enrichedEntities,
    // P1-10: factual_conflicts is part of the same enrichment pass, so it
    // shares the gate. A failed enrichment leaves any previously-persisted
    // conflicts on the row intact (River-merge correctness).
    factual_conflicts:         enrichment.factual_conflicts,
    // P2-1: visual_concepts is emitted by the same enrichment LLM pass, so
    // it follows the same gate — a failed enrichment leaves the previous
    // list (or the migration's empty default) intact rather than wiping it.
    visual_concepts:           enrichment.visual_concepts,
  };
}

// ── Wikipedia attach (P0-4) + override (P2-5) ────────────────────────────────
// Probe Wikipedia REST for each enriched entity and stitch the metadata onto
// the entity object. Stays out of band of synthesis: any per-entity error
// degrades to `resolved: false` (the probe utility never throws), and a
// global failure of probeEntities only loses the metadata for this run —
// the entity is still written with the synthesizer-supplied name/type/role.
//
// `existingContext` survives if the LLM enrichment already wrote a context
// line (e.g. from article quotes); the Wikipedia summary fills in only when
// the enriched entry lacks its own context.
//
// P2-5 — entity_portrait_overrides table check happens FIRST. When an
// override row matches an entity's name, the entity is stamped with
// portrait_* fields (image, attribution, license) AND the Wikipedia probe
// is skipped for that entity. Renderer adapter prefers portrait_* over
// wikipedia_* when both present. Editor-curated press photos win over
// Wikipedia's default lead image on prominent figures.
//
// `supabase` is optional — when omitted (or null), the override lookup is
// skipped and behaviour matches the pre-P2-5 path. Test imports of this
// function that don't pass supabase keep working unchanged.
export async function attachWikipediaToEntities(entities, { signal, supabase } = {}) {
  if (!Array.isArray(entities) || entities.length === 0) return [];

  const names = entities.map(e => e?.name).filter(Boolean);

  // P2-5: batch override lookup. Empty Map on any error / no supabase.
  const overrides = supabase
    ? await lookupPortraitOverrides(supabase, names)
    : new Map();

  // Skip Wikipedia probe for entities that have an override match — saves
  // a network call and the Wikipedia data wouldn't be used anyway.
  const namesNeedingProbe = names.filter((n) => !overrides.has(n));

  let probes;
  try {
    probes = await probeEntities(namesNeedingProbe, { signal });
  } catch {
    return entities.map(e => {
      const ov = overrides.get(e?.name);
      if (ov) return stampOverride(e, ov);
      return { ...e, wiki_resolved: false, wiki_reason: "probe_failed" };
    });
  }

  let probeIdx = 0;
  return entities.map(e => {
    if (!e?.name) return e;

    // P2-5: override wins. Skip the probe slot, stamp portrait fields.
    const ov = overrides.get(e.name);
    if (ov) return stampOverride(e, ov);

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

// P2-5 helper — apply a portrait override row to an entity. Sets
// portrait_* fields (parallel to wikipedia_*) and a portrait_source tag
// so editor tooling can see where the image came from.
function stampOverride(entity, override) {
  return {
    ...entity,
    portrait_image_url:     override.image_url ?? null,
    portrait_thumbnail_url: override.thumbnail_url ?? null,
    portrait_attribution:   override.attribution ?? null,
    portrait_license:       override.license ?? null,
    portrait_source:        "override",
    // Keep the existing wiki_resolved contract honest: an override means
    // we have a portrait, even though the Wikipedia probe was skipped.
    wiki_resolved:          true,
  };
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
    .select("id, primary_entities, key_points, source_documents, updated_at, story_decay_at, published_at")
    .eq("cluster_id", cluster.id)
    .gte("updated_at", riverCutoff)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e1) {
    throw new Error(`river lookup (cluster_id): ${e1.message}`);
  }
  if (byCluster) return byCluster;

  // Strategy 2: entity overlap. Cross-category matches are now allowed — a single
  // breaking event gets RSS-tagged into multiple verticals (the "Starmer resigns"
  // event landed in both `world` and `finance`), and the old `.eq(category_id)`
  // filter left those as separate stories → duplicate social posts. To keep
  // cross-category merges safe we gate them harder than same-category ones:
  //   - same category:  >= 2 shared entities (original bar, now containment-tolerant)
  //   - cross category:  >= 2 shared SPECIFIC named entities, so two unrelated
  //                      stories sharing one proper name + a broad region (e.g.
  //                      two Trump stories sharing "trump" + "us") never collapse.
  const { data: candidates, error: e2 } = await supabase
    .from("stories")
    .select("id, category_id, primary_entities, key_points, source_documents, updated_at, story_decay_at, published_at")
    .gte("updated_at", riverCutoff)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (e2) {
    throw new Error(`river lookup (entity overlap): ${e2.message}`);
  }
  if (!candidates || candidates.length === 0) return null;

  let best = null, bestOverlap = 0;
  for (const story of candidates) {
    const { overlap, specificShared } = tolerantEntityOverlap(
      cluster.primary_entities, story.primary_entities,
    );
    const sameCategory = story.category_id === cluster.category_id;
    const qualifies = sameCategory ? overlap >= 2 : specificShared >= 2;
    if (qualifies && overlap > bestOverlap) {
      best        = story;
      bestOverlap = overlap;
    }
  }

  return best;
}

// P2-2 — related-story linking.
//
// At synth time, find ≤ 3 prior stories in the same category that share
// ≥ 2 entities with the current story. Ranked by overlap count desc,
// then by recency desc as a tiebreak. Stored as `related_stories jsonb`
// on the row so the renderer can surface a Story Arc module without a
// runtime query.
//
// Pure ranking function — supabase fetch is in `findRelatedStories`
// below. The split makes the ranking unit-testable without supabase.
const RELATED_STORY_CAP        = 3;
const RELATED_MIN_OVERLAP      = 2;
const RELATED_LOOKBACK_DAYS    = 90;
const RELATED_CANDIDATE_LIMIT  = 50;

export function pickRelatedStories(currentEntities, candidates, opts = {}) {
  const cap = Number.isInteger(opts.cap) ? opts.cap : RELATED_STORY_CAP;
  const minOverlap = Number.isInteger(opts.minOverlap) ? opts.minOverlap : RELATED_MIN_OVERLAP;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const scored = [];
  for (const c of candidates) {
    if (!c || c.id == null) continue;
    const overlap = countEntityOverlap(currentEntities, c.primary_entities);
    if (overlap < minOverlap) continue;
    scored.push({
      id:       c.id,
      headline: typeof c.headline === "string" ? c.headline : null,
      date:     c.published_at ?? null,
      _overlap: overlap,
    });
  }

  scored.sort((a, b) => {
    if (a._overlap !== b._overlap) return b._overlap - a._overlap;
    // Recency tiebreak — newer first.
    return String(b.date ?? "").localeCompare(String(a.date ?? ""));
  });

  return scored.slice(0, cap).map(({ id, headline, date }) => ({ id, headline, date }));
}

// Codex P1 fix on PR #82 — anchor the 90-day cutoff to the story's own
// `published_at`, not Date.now(). The original `Date.now() - 90d`
// formulation broke historical re-syntheses: a 2023 story reprocessed in
// 2026 produced contradictory filters
//   published_at >= 2026-02 (now − 90d)
//   published_at <  2023-xx (anchor)
// → empty intersection → all related links silently dropped. The
// lookback is logically "90 days BEFORE this story", not "90 days
// before today."
//
// Falls back to `Date.now() - 90d` only when the anchor is absent
// (defensive — synthesizer call sites always pass published_at).
export function relatedStoryCutoff(published_at, lookback_days = RELATED_LOOKBACK_DAYS) {
  const anchorMs = typeof published_at === "string" ? Date.parse(published_at) : NaN;
  const baseMs = Number.isFinite(anchorMs) ? anchorMs : Date.now();
  return new Date(baseMs - lookback_days * 86400 * 1000).toISOString();
}

// Fetch candidates from supabase + delegate ranking to pickRelatedStories.
// Excludes the current story by id when known, and only considers stories
// strictly older than the current row's published_at (no future-arc links).
export async function findRelatedStories(supabase, params) {
  const {
    story_id,
    category_id,
    primary_entities,
    published_at,
    lookback_days = RELATED_LOOKBACK_DAYS,
  } = params ?? {};

  if (!category_id || !Array.isArray(primary_entities) || primary_entities.length < RELATED_MIN_OVERLAP) {
    return [];
  }

  const cutoff = relatedStoryCutoff(published_at, lookback_days);
  let q = supabase
    .from("stories")
    .select("id, headline, published_at, primary_entities")
    .eq("category_id", category_id)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(RELATED_CANDIDATE_LIMIT);

  if (typeof published_at === "string") q = q.lt("published_at", published_at);
  if (story_id != null) q = q.neq("id", story_id);

  const { data: candidates, error } = await q;
  if (error) {
    // Related-stories is non-essential — never fail synthesis on a query error.
    return [];
  }
  return pickRelatedStories(primary_entities, candidates ?? []);
}

// P3-5 + Codex P2 fix on PR #80 — case-insensitive entity overlap with
// dedup on both sides.
//
// Story-side primary_entities is proper-cased ("Asim Munir") after P3-5;
// cluster-side is still lowercased from the clusterer's regex extraction
// ("asim munir"). Without normalisation the overlap filter would silently
// miss matches between post-P3-5 stories and pre-P3-5 clusters.
//
// Without dedup, case/whitespace variants ("Asim Munir", "asim munir",
// "ASIM MUNIR ") collapse to the same normalised token and inflate
// overlap past the ≥ 2 threshold with only one unique shared entity —
// false River merges between stories that should remain separate.
//
// Returns the count of UNIQUE entities present in both lists.
export function countEntityOverlap(clusterEntities, storyEntities) {
  const norm = (e) => String(e ?? "").toLowerCase().trim();
  const clusterSet = new Set(
    (Array.isArray(clusterEntities) ? clusterEntities : [])
      .map(norm)
      .filter(Boolean),
  );
  const storySet = new Set(
    (Array.isArray(storyEntities) ? storyEntities : [])
      .map(norm)
      .filter(Boolean),
  );
  let overlap = 0;
  for (const e of clusterSet) {
    if (storySet.has(e)) overlap++;
  }
  return overlap;
}

// Whole-word containment match: "keir starmer" aligns with "prime minister keir
// starmer", "labour" with "labour party". Padding both sides with spaces keeps it
// token-boundary-safe so unrelated substrings ("art" vs "smart") do NOT align.
function entitiesAlign(a, b) {
  if (a === b) return true;
  return ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
}

// Tolerant entity overlap for the River merge. Unlike countEntityOverlap (exact,
// case-insensitive), this also matches an entity that is a whole-word subset of
// the other side's entity — needed because the cluster extractor and the LLM
// proper-caser disagree on title prefixes ("keir starmer" vs "prime minister
// keir starmer") and qualifiers ("labour" vs "labour party"), which is exactly
// how the 3-way "Starmer resigns" duplication slipped past the same-category
// exact-overlap gate. Returns both the raw overlap and how many of the shared
// entities are STORY-SPECIFIC named entities (not a broad region or a generic
// high-signal single like "us"/"ai"). Cross-category merges gate on
// specificShared so two unrelated stories that merely share one proper name plus
// a broad region (e.g. two different Trump stories sharing "trump" + "us") do
// NOT collapse together.
export function tolerantEntityOverlap(clusterEntities, storyEntities) {
  const norm = (e) => String(e ?? "").toLowerCase().trim();
  const cl = [...new Set(
    (Array.isArray(clusterEntities) ? clusterEntities : []).map(norm).filter(Boolean),
  )];
  const st = [...new Set(
    (Array.isArray(storyEntities) ? storyEntities : []).map(norm).filter(Boolean),
  )];

  let overlap = 0, specificShared = 0;
  for (const c of cl) {
    // Pick the longest aligning story entity so "labour" pairs with the richer
    // "labour party" form when judging specificity.
    let match = null;
    for (const s of st) {
      if (entitiesAlign(c, s) && (!match || s.length > match.length)) match = s;
    }
    if (!match) continue;
    overlap++;
    const richer = match.length >= c.length ? match : c;
    if (isSpecificNamedEntity(richer)) specificShared++;
  }
  return { overlap, specificShared };
}

// ── Main handler ──────────────────────────────────────────────────────────────
//
// Exported as `run` (the name function.json points to via entryPoint) AND
// `storySynthesizer` (test imports use this name) AND default. Azure
// Functions Node.js host can't auto-pick an entry point when a module has
// multiple exports — without the explicit entryPoint it throws "Worker
// was unable to load function story-synthesizer". Story 170 re-synth at
// 21:23 dead-lettered after 3 attempts because of exactly this.

export async function run(context, message) {
  const { cluster_id } = message;

  const supabase = getSupabase();
  const ai       = getAnthropic();

  // ── 1. Fetch cluster — idempotency check + stale-lease reclaim ───────────
  // status + updated_at drive a lease: PENDING is freely claimable; a
  // PROCESSING row whose updated_at is older than PROCESSING_LEASE_MS is
  // treated as a dead invocation (the 2026-06-15 wedge) and is reclaimable.
  // A PROCESSING row inside the lease window is an actively-running sibling
  // invocation — defer to it and no-op.
  const { data: cluster, error: clusterErr } = await supabase
    .from("clusters")
    .select("id, category_id, primary_entities, article_ids, unique_domains, cluster_score, status, updated_at, primary_geos, geo_scores, source_countries")
    .eq("id", cluster_id)
    .single();

  if (clusterErr) {
    throw new Error(`[story-synthesizer] fetch cluster ${cluster_id}: ${clusterErr.message}`);
  }

  if (!cluster) {
    context.log(JSON.stringify({ event: "cluster_not_pending", cluster_id, status: "not_found" }));
    return;
  }

  const leaseExpiry = new Date(Date.now() - PROCESSING_LEASE_MS).toISOString();
  const isPending      = cluster.status === "PENDING";
  const isStaleProcessing =
    cluster.status === "PROCESSING" &&
    typeof cluster.updated_at === "string" &&
    cluster.updated_at < leaseExpiry;

  if (!isPending && !isStaleProcessing) {
    // Terminal (PROCESSED) or an actively-running sibling (fresh PROCESSING) —
    // complete and return so we don't double-synthesize.
    context.log(JSON.stringify({
      event:      "cluster_not_pending",
      cluster_id,
      status:     cluster.status,
      updated_at: cluster.updated_at,
    }));
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // ── 2. Atomically CLAIM the lease (move the PROCESSING write here) ────────
  // Race-safety: this is a conditional UPDATE. The WHERE re-asserts the exact
  // (id, status, prior-updated_at) we read above, so only ONE racer can flip
  // the row — a concurrent duplicate's WHERE no longer matches (updated_at
  // moved) and updates 0 rows, so it bails. This both prevents two messages
  // from synthesising the same cluster AND lets a redelivery reclaim a wedged
  // (stale-PROCESSING) cluster. We pass `updated_at` as the lease token; the
  // synthesizer renews it on the PROCESSED write at the end (or on the error
  // resets). PostgREST returns the updated rows via .select(); an empty array
  // means we lost the claim.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("clusters")
    .update({ status: "PROCESSING", updated_at: claimedAt })
    .eq("id", cluster_id)
    .eq("status", cluster.status)
    .eq("updated_at", cluster.updated_at)
    .select("id");

  if (claimErr) {
    throw new Error(`[story-synthesizer] claim cluster ${cluster_id}: ${claimErr.message}`);
  }

  if (!claimed || claimed.length === 0) {
    // Lost the race to a concurrent invocation that claimed first. Bail —
    // the winner owns this cluster. Return normally so SB completes our msg.
    context.log(JSON.stringify({ event: "cluster_claim_lost", cluster_id, prior_status: cluster.status }));
    return;
  }

  if (isStaleProcessing) {
    context.log(JSON.stringify({
      event:           "cluster_lease_reclaimed",
      cluster_id,
      stale_since:     cluster.updated_at,
    }));
  }

  // ── 3. Fetch article content ──────────────────────────────────────────────
  // canonical_url / published_at / author are needed in addition to NLP fields
  // because we snapshot a source_documents projection onto the story row (P0-1).
  const { data: articles, error: artErr } = await supabase
    .from("raw_articles")
    .select("id, title, description, content, domain, canonical_url, published_at, author, mentioned_geos, source_country, language, geo_scores, authority_score")
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
  // P2-5: passing `supabase` enables the entity_portrait_overrides
  // lookup, which short-circuits the Wikipedia probe for entities that
  // have a curated press photo.
  const enrichedEntities = await attachWikipediaToEntities(
    enrichment.primary_entities_enriched,
    { supabase },
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

  // Per-category synthesis gate thresholds (lib/flags.js). For `ai` these are
  // relaxed (confidence 6, key_points 2, story review 28) so PR #132's thinner
  // AI clusters can write a story; every other category resolves to `default`
  // and is byte-for-byte identical to the prior hard-coded constants (6 / 3 / 35).
  const synthCategory   = cluster.category_id;
  const minConfidence   = synthThreshold(SYNTH.confidence,  synthCategory);
  const minKeyPoints    = synthThreshold(SYNTH.keyPoints,   synthCategory);
  const minStoryReview  = synthThreshold(SYNTH.storyReview, synthCategory);
  const minDomainsGate  = synthThreshold(SYNTH.minUniqueDomains, synthCategory);

  // Corroboration floor: the relaxed AI bar is only sound on multi-source
  // clusters. Clustering already enforces >=2 domains, but assert it here so a
  // future clustering change can't leak a single-domain singleton through the
  // lowered gates. A cluster below its category's domain floor is rejected
  // regardless of confidence/score (default floor is 1 → no-op for non-AI).
  const uniqueDomainCount = Array.isArray(cluster.unique_domains)
    ? new Set(cluster.unique_domains).size
    : 0;
  if (uniqueDomainCount < minDomainsGate) {
    context.log(JSON.stringify({ event: "LOW_DOMAIN_DIVERSITY", cluster_id, category_id: synthCategory, unique_domains: uniqueDomainCount, min: minDomainsGate }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Quality gate: confidence
  if (narrative.confidence_score < minConfidence) {
    context.log(JSON.stringify({ event: "LOW_CONFIDENCE", cluster_id, category_id: synthCategory, confidence: narrative.confidence_score, min: minConfidence }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Quality gate: key_points completeness
  if (narrative.key_points.length < minKeyPoints) {
    context.log(JSON.stringify({ event: "LOW_KEY_POINTS", cluster_id, category_id: synthCategory, count: narrative.key_points.length, min: minKeyPoints }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Scoring
  const synthesisResult = { ...narrative, facts };
  const { story_score, consistency_score, source_count } = computeStoryScore(cluster, synthesisResult);
  // disposition uses the global thresholds for publish/review labelling; the
  // *reject* gate below uses the per-category review floor so `ai` passes at a
  // lower bar without re-labelling other paths.
  let disposition = storyDisposition(story_score);

  if (story_score < minStoryReview) {
    context.log(JSON.stringify({ event: "LOW_STORY_SCORE", cluster_id, category_id: synthCategory, story_score, min: minStoryReview, disposition }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Story admitted (story_score >= minStoryReview). On the relaxed `ai` path a
  // story can clear its category floor (28) while still below the global review
  // tier (35), where storyDisposition() returns "reject". Relabel that to
  // "review" so the story_written / story_merged telemetry below never logs a
  // "reject" disposition for a story that was actually created.
  if (disposition === "reject") disposition = "review";

  // Geo metadata for story
  const globalSignificanceScore = computeGlobalSignificance(cluster, narrative, articles);
  // P3-1: merge entity-tagged places (LLM-identified, editorial-strength)
  // with cluster-aggregated primary_geos. Entity-derived codes lead the
  // list so MapCallout / `primary_geos[0]` resolves to the strongest
  // editorial signal — fixes the story 170 case where Indian-outlet
  // aggregation otherwise dominated a Persian Gulf story.
  const storyPrimaryGeos = mergeEntityAndClusterGeos(cluster.primary_geos, enrichedEntities);
  const storyGeoScores   = cluster.geo_scores   ?? {};
  const storyPrimaryPlaces = resolvePrimaryPlaces(storyPrimaryGeos);

  context.log(JSON.stringify({
    event:               "primary_geos_merged",
    cluster_id,
    cluster_geos:        cluster.primary_geos ?? [],
    entity_place_count:  Array.isArray(enrichedEntities) ? enrichedEntities.filter((e) => e?.type === "place").length : 0,
    merged:              storyPrimaryGeos,
  }));

  // Extras for computeAudienceProjection (india_article_fraction requires article-level data)
  const indianArticleCount    = articles.filter(a => a.source_country === "in").length;
  const indianArticleFraction = articles.length > 0 ? indianArticleCount / articles.length : 0;

  // P0-1 + P0-2: snapshot source documents from the cluster's articles, with
  // any verified verbatim quotes attached to the originating doc.
  const incomingSourceDocs = buildSourceDocuments(articles, verbatimQuotes);

  // P3-5: clean entity names — used for both the `primary_entities` column
  // write and the P2-2 related-story overlap match.
  const cleanedEntities = cleanPrimaryEntities(enrichedEntities, cluster.primary_entities);

  // P2-4: aggregate source-language signals from feed metadata + body
  // script detection. Stories whose synthesis relied on non-English
  // sources are flagged so the editor can verify translation drift
  // before the renderer ships.
  const languageRollup = aggregateArticleLanguages(articles);
  context.log(JSON.stringify({
    event:                 "languages_aggregated",
    cluster_id,
    original_languages:    languageRollup.original_languages,
    translation_required:  languageRollup.translation_required,
  }));

  context.log(JSON.stringify({
    event:           "source_documents_snapshot",
    cluster_id,
    document_count:  incomingSourceDocs.length,
    quote_count:     verbatimQuotes.length,
  }));

  // P1-8: source diversity score. Computed from the same article set the
  // source_documents snapshot uses — so the score is consistent with what
  // the renderer will see in EvidenceShelf. Pure function, no I/O. Always
  // recompute on River merge: a story that gained an independent source
  // since the prior synthesis should reflect the higher diversity.
  const diversity = computeSourceDiversity(articles);
  context.log(JSON.stringify({
    event:                  "source_diversity_computed",
    cluster_id,
    score:                  diversity.score,
    label:                  diversity.label,
    domain_count:           diversity.domain_count,
    wire_count:             diversity.wire_count,
    non_wire_count:         diversity.non_wire_count,
  }));

  // River model: find or create story — Step 2 of processing contract
  const riverCutoff   = new Date(Date.now() - RIVER_WINDOW_MS).toISOString();
  const existingStory = await findExistingStory(supabase, cluster, riverCutoff);

  // P2-2: find ≤ 3 prior related stories in same category sharing ≥ 2
  // entities. Computed against cleanedEntities (post-P3-5 proper-cased
  // names). For River-merge UPDATE, anchor "before this row" at the
  // existing row's published_at so the arc stays directional. For INSERT,
  // anchor at synth time. Non-essential — defaults to [] on query error.
  const relatedAnchorDate = existingStory ? existingStory.published_at : now;
  const relatedStories = await findRelatedStories(supabase, {
    story_id:         existingStory?.id ?? null,
    category_id:      cluster.category_id,
    primary_entities: cleanedEntities,
    published_at:     relatedAnchorDate,
  });
  context.log(JSON.stringify({
    event:           "related_stories_computed",
    cluster_id,
    story_id:        existingStory?.id ?? null,
    related_count:   relatedStories.length,
    related_ids:     relatedStories.map((r) => r.id),
  }));

  let story_id;

  if (existingStory) {
    const existingPoints  = Array.isArray(existingStory.key_points) ? existingStory.key_points : [];
    const mergedKeyPoints = [...new Set([...existingPoints, ...narrative.key_points])].slice(0, 10);
    const mergedSourceDocs = mergeSourceDocuments(existingStory.source_documents, incomingSourceDocs);

    // P1-8 (Codex P1 fix on PR #72): recompute diversity from the merged
    // source set — NOT from the current cluster's articles alone. The
    // EvidenceShelf the renderer shows is built from mergedSourceDocs;
    // storing diversity computed from a subset would mislabel an older
    // multi-domain story as low-diversity the moment a single new wire
    // pickup updates it. computeSourceDiversity reads `.domain`, source
    // documents carry the same value under `.issuer`, hence the shape map.
    // 2026-05-09: also pass author + source_country so the diversity calc
    // can detect same-author concentration and single-country source sets.
    // `author` is undefined on rows synthesised before commit 3; the calc
    // treats undefined as "no author" so older rows stay backward-compatible.
    const mergedDiversity = computeSourceDiversity(
      mergedSourceDocs.map(d => ({
        domain:         d.issuer,
        author:         d.author ?? null,
        source_country: d.source_country ?? null,
      })),
    );
    context.log(JSON.stringify({
      event:           "source_diversity_recomputed_on_merge",
      cluster_id,
      story_id:        existingStory.id,
      pre_merge_score: diversity.score,
      pre_merge_label: diversity.label,
      merged_score:    mergedDiversity.score,
      merged_label:    mergedDiversity.label,
      merged_domains:  mergedDiversity.domain_count,
    }));

    // P2-3: recompute eligibility against the *merged* evidence shelf —
    // a story that gained an independent source since the prior synthesis
    // may flip from "single_source_coverage" to eligible. Inputs other
    // than diversity (confidence, posture, headline/summary) come from
    // this synthesis pass since the row's text fields are being overwritten.
    // 2026-05-09: pass primary_entities + enriched + story_type + geos +
    // source_documents so gates 6 (no_enriched_entities) and 7
    // (single_country_outside_theatre) can fire on the merge path.
    const mergedEligibility = computeVideoEligibility({
      confidence_score:          narrative.confidence_score,
      editorial_posture:         enrichment.editorial_posture,
      headline:                  narrative.headline,
      summary:                   narrative.summary,
      diversity:                 mergedDiversity,
      article_count:             mergedSourceDocs.length,
      story_type:                enrichment.story_type,
      primary_entities:          cleanedEntities,
      primary_entities_enriched: enrichedEntities,
      primary_geos:              storyPrimaryGeos,
      source_documents:          mergedSourceDocs,
      visual_concepts:           enrichment.visual_concepts,
    });
    context.log(JSON.stringify({
      event:       "video_eligibility_computed",
      cluster_id,
      story_id:    existingStory.id,
      eligible:    mergedEligibility.eligible,
      reason:      mergedEligibility.reason,
      path:        "merge",
    }));

    const { error: updateErr } = await supabase
      .from("stories")
      .update({
        // P3-5: clean entities from the enriched jsonb; falls back to
        // cluster.primary_entities only when enrichment failed. Replaces
        // the dirty cluster-NLP array on every successful re-synth.
        primary_entities:          cleanedEntities,
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
        // P1-8: recompute on every River-merge from the merged evidence
        // shelf, so the persisted score reflects what the renderer sees.
        source_diversity_score:    mergedDiversity.score,
        source_diversity_label:    mergedDiversity.label,
        // P1-9: verification_status is intentionally NOT updated here.
        // Editor decisions (verified/published/corrected/retracted) are
        // sticky across re-syntheses; overwriting them with 'draft' would
        // silently revert editorial review.
        // P2-3: video_eligible recomputed every River-merge for the same
        // reason as source_diversity — gained sources can flip an earlier
        // skip-reason. video_skip_reason cleared to null on eligible=true.
        video_eligible:            mergedEligibility.eligible,
        video_skip_reason:         mergedEligibility.reason,
        // P4-2: story_decay_at backfill. Pre-P2-6 rows have NULL forever
        // because the previous policy was "never update on River-merge"
        // (correct in steady state, but starves historical rows that have
        // no decay value). New policy: COALESCE — keep an existing
        // timestamp if present, else fill from the row's actual
        // published_at + per-category window. Pinned-to-publication
        // semantics preserved; no reset on re-pickup.
        story_decay_at:            existingStory.story_decay_at ??
                                    computeStoryDecayAt(cluster.category_id, existingStory.published_at),
        // P2-2: refresh on every River-merge — gained entity coverage may
        // unlock new related-story matches that weren't visible at insert.
        related_stories:           relatedStories,
        // P2-4: refresh translation flags every River-merge — a newly-
        // joined article in a non-English language flips the flag.
        original_languages:        languageRollup.original_languages,
        translation_required:      languageRollup.translation_required,
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
    // P2-3: eligibility for a fresh row uses the inserting cluster's
    // articles + the synthesizer's diversity score (no merge to consider
    // since this is the first synthesis).
    // 2026-05-09: see merge path above for the rationale on the new fields.
    const insertEligibility = computeVideoEligibility({
      confidence_score:          narrative.confidence_score,
      editorial_posture:         enrichment.editorial_posture,
      headline:                  narrative.headline,
      summary:                   narrative.summary,
      diversity,
      article_count:             articles.length,
      story_type:                enrichment.story_type,
      primary_entities:          cleanedEntities,
      primary_entities_enriched: enrichedEntities,
      primary_geos:              storyPrimaryGeos,
      source_documents:          incomingSourceDocs,
      visual_concepts:           enrichment.visual_concepts,
    });
    context.log(JSON.stringify({
      event:       "video_eligibility_computed",
      cluster_id,
      eligible:    insertEligibility.eligible,
      reason:      insertEligibility.reason,
      path:        "insert",
    }));

    // P2-6: story_decay_at pinned to published_at + per-category window.
    // Falls back to a default decay when category is missing/unknown so
    // every row carries a defensible freshness timestamp.
    const decayAt = computeStoryDecayAt(cluster.category_id, now);

    const { data: inserted, error: insertErr } = await supabase
      .from("stories")
      .insert({
        cluster_id,
        category_id:               cluster.category_id,
        // P3-5: clean entities from the enriched jsonb. See UPDATE branch
        // above for the rationale.
        primary_entities:          cleanedEntities,
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
        // P1-8: source diversity for the inserting article set.
        source_diversity_score:    diversity.score,
        source_diversity_label:    diversity.label,
        // P1-9: every synthesizer-emitted row enters as 'draft'. Editor
        // promotes to 'verified' / 'published' downstream. Migration
        // back-filled existing is_verified=true rows to 'verified', so
        // both pre- and post-migration rows carry honest lifecycle state.
        verification_status:       "draft",
        // P2-3: editorial gate, derived from this synthesis pass. Stored
        // alongside the reason so the editor can see *why* without
        // re-running the rule. Both fields stay queryable from SQL.
        video_eligible:            insertEligibility.eligible,
        video_skip_reason:         insertEligibility.reason,
        // P2-6: per-category decay timestamp. Renderer flips to ARCHIVE
        // posture chip after this point.
        story_decay_at:            decayAt,
        // P2-2: ≤ 3 prior stories with ≥ 2 entity overlap.
        related_stories:           relatedStories,
        // P2-4: source-language signals (feed metadata + body script
        // detection). translation_required = true → editor review gate
        // before renderer consumption.
        original_languages:        languageRollup.original_languages,
        translation_required:      languageRollup.translation_required,
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

// Back-compat aliases for test imports (synthesizer-data.test.js,
// smoke-p1-final.js) that historically used `storySynthesizer` or the
// default export. The Azure Functions host uses `run` per function.json.
export { run as storySynthesizer };
export default run;
