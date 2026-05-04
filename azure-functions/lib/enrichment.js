// Story enrichment pass — emits the structured fields the video pipeline
// expects beyond headline / summary / key_points.
//
// Covers items from docs/data-pipeline-improvements-tracker.md:
//   P0-5  granular story_type
//   P1-1  structured_numbers (money / counts / percentages / magnitudes / casualties)
//   P1-2  hook_sentence (10–18 words, declarative)
//   P1-3  editorial_posture enum
//   P1-4  primary_entities upgraded to objects with name / type / role
//   P1-5  timeline_events (date / label / source_id)
//   P1-6  per-entity context bio (Wikipedia summary stitches in here)
//   P1-7  why_it_matters
//   P1-10 factual_conflicts (numeric / factual divergence between sources)
//
// Design choices:
//   - One Claude pass, structured JSON. The synthesizer narrative pass already
//     gives us headline/summary/key_points; extracting these fields again from
//     the article bodies is the natural place to do it.
//   - This pass is non-essential. If Claude returns garbage, the synthesiser
//     proceeds with default empty fields rather than failing the whole story —
//     mirrors the P0-2 quote extraction policy.
//   - All field validators are local: structurally invalid items are dropped,
//     not "fixed up". A wrong value would mislead downstream renderers.
//   - The enrichment result is intentionally storage-shaped: every value can
//     be persisted as-is to the corresponding story column.

const MODEL          = "claude-sonnet-4-20250514";
const ENRICH_TOKENS  = 2048;
const HOOK_MIN_WORDS = 8;
const HOOK_MAX_WORDS = 22;
// Match story-synthesizer/index.js CONTENT_TRUNCATE — both trim article bodies
// to the same length so the LLM sees the same context across passes.
const CONTENT_TRUNCATE_FOR_PROMPTS = 500;

// Closed sets — drift here breaks the video pipeline's posture chips and
// type-routing. Keep aligned with video-pipeline-v2/src/pipeline/understand/
// story-types/index.js and the editorial_posture chip mapping.
export const STORY_TYPES = Object.freeze([
  "legal_scandal",
  "geopolitics_world",
  "finance_markets",
  "election_result",
  "natural_disaster",
  "tech_cyber",
  "culture_entertainment",
  "sports",
  "religion_society",
  "tech_product",
  "science_health",
  "crime_general",
  "general",
]);

export const EDITORIAL_POSTURES = Object.freeze([
  "indictment_alleged",
  "disclosure_official",
  "tally_official",
  "policy_decision",
  "disaster_provisional",
  "cultural_moment",
  "breaking_developing",
  "analysis_explainer",
]);

export const ENTITY_TYPES = Object.freeze([
  "person",
  "place",
  "org",       // company, agency, NGO, party — anything non-person, non-place
]);

const STORY_TYPE_SET = new Set(STORY_TYPES);
const POSTURE_SET    = new Set(EDITORIAL_POSTURES);
const ENTITY_TYPE_SET = new Set(ENTITY_TYPES);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Default enrichment payload. Returned when the LLM pass fails or is skipped;
 * also used to fill in any missing keys when the LLM only emits a subset.
 */
export function emptyEnrichment() {
  return {
    story_type:                "general",
    editorial_posture:         null,
    hook_sentence:             null,
    why_it_matters:            null,
    structured_numbers: {
      money:        [],
      counts:       [],
      percentages:  [],
      magnitudes:   [],
      casualties:   [],
    },
    timeline_events:           [],
    primary_entities_enriched: [],
    factual_conflicts:         [],
  };
}

/**
 * Run the enrichment Claude pass. Never throws — failures degrade to
 * `emptyEnrichment()` so the synthesiser can still write the core story.
 *
 * The success path attaches a non-enumerable `_ok: true` marker so callers
 * can distinguish "we synthesised this story but enrichment LLM failed" from
 * "we genuinely picked the empty defaults". Critical for River-merge: a
 * transient LLM blip must NOT overwrite previously-enriched columns with
 * fallback values. See `enrichmentSucceeded` for the read side.
 *
 * The `_ok` field is non-enumerable, so `JSON.stringify`, `Object.entries`,
 * and object spread (`{...enrichment}`) all ignore it — the marker never
 * leaks into the persisted row.
 *
 * @param {Anthropic} ai
 * @param {{ category_id?: string, primary_entities?: string[] }} cluster
 * @param {Array<{ id, title, description?, content?, domain, canonical_url?, published_at? }>} articles
 * @param {{ headline: string, summary: string, key_points: string[] }} narrative
 * @returns {Promise<ReturnType<typeof emptyEnrichment>>}
 */
export async function enrichNarrative(ai, cluster, articles, narrative) {
  if (!ai || !articles?.length) return emptyEnrichment();

  let raw;
  try {
    raw = await callEnrichmentLLM(ai, cluster, articles, narrative);
  } catch {
    return emptyEnrichment();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyEnrichment();
  }

  return markOk(validateEnrichment(parsed, articles));
}

/**
 * True when the enrichment LLM call succeeded and produced parseable JSON
 * (validation may still have dropped malformed individual fields). Callers
 * use this to gate database writes that would otherwise overwrite previously-
 * persisted enrichment with fallback defaults.
 */
export function enrichmentSucceeded(enrichment) {
  return Boolean(enrichment && enrichment._ok === true);
}

// Internal: stamp the result with a non-enumerable success marker.
function markOk(result) {
  Object.defineProperty(result, "_ok", { value: true, enumerable: false });
  return result;
}

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callEnrichmentLLM(ai, cluster, articles, narrative) {
  const articleBlocks = articles
    .map((a, i) => {
      const body = [
        a.title,
        a.description,
        a.content ? a.content.slice(0, CONTENT_TRUNCATE_FOR_PROMPTS) : null,
      ].filter(Boolean).join(" ");
      return `[Article ${i + 1} — id=${a.id} — ${a.domain ?? "unknown"}]\n${body}`;
    })
    .join("\n\n");

  const entityHints = Array.isArray(cluster?.primary_entities)
    ? cluster.primary_entities.filter(Boolean).join(", ")
    : "";

  const prompt = `You are an enrichment pass for a news video pipeline. The story has already been
synthesised; your job is to project structured fields the renderer needs.

Synthesised story:
- Headline: ${narrative.headline}
- Summary:  ${narrative.summary}
- Key points:
${narrative.key_points.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}

Topic entities (hints, may be partial / messy): ${entityHints || "(none)"}
Category: ${cluster?.category_id ?? "(unknown)"}

Source articles:
${articleBlocks}

Respond ONLY with a single JSON object — no markdown fences, no preamble. Use this shape:
{
  "story_type":        one of [${STORY_TYPES.map((t) => `"${t}"`).join(", ")}],
  "editorial_posture": one of [${EDITORIAL_POSTURES.map((p) => `"${p}"`).join(", ")}],
  "hook_sentence":     "Declarative, ${HOOK_MIN_WORDS}-${HOOK_MAX_WORDS} words, no question marks. Optimised for the first 3 seconds of a spoken short-form video.",
  "why_it_matters":    "One sentence (under 30 words) explaining what this means for an ordinary viewer.",
  "structured_numbers": {
    "money":       [{ "display": "$8 billion",     "value": 8000000000, "role": "alleged take" }],
    "counts":      [{ "display": "25 years",       "value": 25,          "unit": "years",  "label": "sentence" }],
    "percentages": [{ "display": "54.3%",          "value": 54.3,        "role": "winner share" }],
    "magnitudes":  [{ "display": "M 7.2",          "value": 7.2,         "unit": "Mw",    "label": "earthquake magnitude" }],
    "casualties":  [{ "display": "at least 17 dead", "value": 17,        "label": "fatalities" }]
  },
  "timeline_events": [
    { "date": "YYYY-MM-DD", "label": "What happened on this date (≤ 8 words)", "source_id": <integer article id from above, or null> }
  ],
  "primary_entities_enriched": [
    { "name": "Display Name", "type": "person|place|org", "role": "their role in this story (≤ 6 words)", "context": "One-sentence bio or context (≤ 30 words). Optional — null if unknown." }
  ],
  "factual_conflicts": [
    { "claim": "what the conflicting sources disagree about (≤ 8 words)",
      "values": ["value as reported by source A (issuer)", "value as reported by source B (issuer)"],
      "preferred": "the value you would lead with, must match one of \`values\` verbatim" }
  ]
}

Rules:
- story_type: pick the MOST specific bucket that fits. Use "general" only if the story genuinely doesn't fit any specialised type.
- editorial_posture: classify the story's stance — allegations vs official tally vs developing news, etc. Use the closest single match.
- hook_sentence: spoken-word ready; viewer-led, not headline-style.
- structured_numbers: extract ONLY numbers that appear in the source articles. Do not infer or guess.
  - "value" must be the numeric value, not a string. Use raw units (8000000000 for "$8 billion").
  - Empty arrays are fine. Skip the field entirely rather than emit fakes.
- timeline_events: dates must be defensible from the articles. \`source_id\` is the integer id of the article that supports the date.
  - Skip undated context. ≤ 5 events.
- primary_entities_enriched: ≤ 6 entries. Display names should be the canonical proper-cased form. Drop generic terms like "the company" or "the agency".
  - Use the topic-entity hints as candidates only — refine names, drop noise, add anyone material the hints missed.
- factual_conflicts: report ONLY when two or more sources above give materially different values for the same claim (e.g. casualty count, dollar amount, vote share). Do not invent disagreement.
  - "values" entries should each name the issuer in parentheses so an editor can adjudicate. ≤ 4 entries.
  - "preferred" must match one of the entries in \`values\` exactly. Prefer official / primary sources over wire / aggregator sources.
  - Empty array if all sources agree or only one source covers the claim.
- Every field is required. If you have nothing for a field, emit the empty default (\`null\`, \`[]\`, or \`{...empty arrays...}\`).`;

  const msg = await ai.messages.create({
    model:      MODEL,
    max_tokens: ENRICH_TOKENS,
    messages:   [{ role: "user", content: prompt }],
  });
  return msg?.content?.[0]?.text?.trim() ?? "";
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateEnrichment(input, articles) {
  const out = emptyEnrichment();
  if (!input || typeof input !== "object") return out;

  if (typeof input.story_type === "string" && STORY_TYPE_SET.has(input.story_type)) {
    out.story_type = input.story_type;
  }
  if (typeof input.editorial_posture === "string" && POSTURE_SET.has(input.editorial_posture)) {
    out.editorial_posture = input.editorial_posture;
  }
  out.hook_sentence  = sanitiseHook(input.hook_sentence);
  out.why_it_matters = sanitiseSentence(input.why_it_matters, 200);

  out.structured_numbers = sanitiseStructuredNumbers(input.structured_numbers);
  out.timeline_events    = sanitiseTimelineEvents(input.timeline_events, articles);
  out.primary_entities_enriched = sanitiseEntities(input.primary_entities_enriched);
  out.factual_conflicts  = sanitiseFactualConflicts(input.factual_conflicts);

  return out;
}

function sanitiseHook(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.includes("?")) return null;          // hooks must be declarative
  const words = trimmed.split(" ").length;
  if (words < HOOK_MIN_WORDS || words > HOOK_MAX_WORDS) return null;
  return trimmed;
}

function sanitiseSentence(value, maxChars) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > maxChars) return trimmed.slice(0, maxChars).replace(/\s+\S*$/, "");
  return trimmed;
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function sanitiseStructuredNumbers(input) {
  const result = { money: [], counts: [], percentages: [], magnitudes: [], casualties: [] };
  if (!input || typeof input !== "object") return result;

  result.money       = arrayOf(input.money,       (e) => sanitiseNumberEntry(e, ["display", "value"], { role: true }));
  result.counts      = arrayOf(input.counts,      (e) => sanitiseNumberEntry(e, ["display", "value"], { unit: true, label: true }));
  result.percentages = arrayOf(input.percentages, (e) => sanitiseNumberEntry(e, ["display", "value"], { role: true }));
  result.magnitudes  = arrayOf(input.magnitudes,  (e) => sanitiseNumberEntry(e, ["display", "value"], { unit: true, label: true }));
  result.casualties  = arrayOf(input.casualties,  (e) => sanitiseNumberEntry(e, ["display", "value"], { label: true }));
  return result;
}

function sanitiseNumberEntry(entry, required, optional) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.display !== "string" || !entry.display.trim()) return null;
  if (!isFiniteNumber(entry.value)) return null;
  const out = { display: entry.display.trim(), value: entry.value };
  if (optional?.role  && typeof entry.role  === "string" && entry.role.trim())  out.role  = entry.role.trim();
  if (optional?.unit  && typeof entry.unit  === "string" && entry.unit.trim())  out.unit  = entry.unit.trim();
  if (optional?.label && typeof entry.label === "string" && entry.label.trim()) out.label = entry.label.trim();
  // If neither role nor unit/label survived, that's still acceptable — display+value alone is renderable.
  void required;
  return out;
}

function sanitiseTimelineEvents(input, articles) {
  const articleIds = new Set(Array.isArray(articles) ? articles.map((a) => Number(a.id)).filter(Number.isFinite) : []);
  return arrayOf(input, (e) => {
    if (!e || typeof e !== "object") return null;
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date.trim())) return null;
    if (typeof e.label !== "string" || !e.label.trim()) return null;
    const out = { date: e.date.trim(), label: e.label.trim() };
    // Accept a source_id only when it points at one of THIS cluster's articles.
    // Anything else is hallucinated and would mislead the EvidenceShelf.
    const sid = Number(e.source_id);
    out.source_id = Number.isFinite(sid) && articleIds.has(sid) ? sid : null;
    return out;
  }, 8);
}

function sanitiseEntities(input) {
  return arrayOf(input, (e) => {
    if (!e || typeof e !== "object") return null;
    if (typeof e.name !== "string" || !e.name.trim()) return null;
    const type = typeof e.type === "string" && ENTITY_TYPE_SET.has(e.type) ? e.type : null;
    if (!type) return null;
    const out = { name: e.name.trim(), type };
    if (typeof e.role    === "string" && e.role.trim())    out.role    = e.role.trim().slice(0, 80);
    if (typeof e.context === "string" && e.context.trim()) out.context = e.context.trim().slice(0, 280);
    return out;
  }, 8);
}

// P1-10 — factual conflicts. The LLM is prompted to report only when
// sources materially disagree; we drop anything that doesn't pass the
// shape check (must have ≥ 2 distinct values, and `preferred` must match
// one of them verbatim) so half-formed entries can't reach the renderer
// and look like editor-adjudicated divergence.
function sanitiseFactualConflicts(input) {
  return arrayOf(input, (c) => {
    if (!c || typeof c !== "object") return null;
    if (typeof c.claim !== "string" || !c.claim.trim()) return null;
    if (!Array.isArray(c.values)) return null;

    const cleanValues = [];
    for (const v of c.values) {
      if (typeof v !== "string") continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      if (cleanValues.length >= 4) break;
      // Reject duplicate phrasings — "no conflict here" masquerading as one.
      if (cleanValues.includes(trimmed)) continue;
      cleanValues.push(trimmed.slice(0, 160));
    }
    if (cleanValues.length < 2) return null;

    const out = { claim: c.claim.trim().slice(0, 120), values: cleanValues };

    if (typeof c.preferred === "string" && c.preferred.trim()) {
      const pref = c.preferred.trim().slice(0, 160);
      // `preferred` must be one of the surviving values. If the LLM
      // emitted something synthesised, drop the field rather than
      // attaching a value the editor didn't actually pick.
      if (cleanValues.includes(pref)) out.preferred = pref;
    }

    return out;
  }, 4);
}

function arrayOf(input, mapper, max = 16) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    if (out.length >= max) break;
    const mapped = mapper(item);
    if (mapped) out.push(mapped);
  }
  return out;
}
