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
//   P2-1  visual_concepts (concrete renderable visuals per story)
//   P2-7  per-entity phonetic hint (TTS pronunciation)
//   P3-4  timeline_disposition + article-date fallback when LLM extraction is thin
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
    // P3-4 — disposition tells the renderer what it's getting:
    //   "absent"    — no events, neither LLM nor fallback could derive any
    //   "single_day" — events all collapse to one date (TimelineCard should skip)
    //   "multi_day"  — at least 2 distinct dates (TimelineCard renders)
    //   "fallback"   — LLM yielded ≤1 distinct date, but article-date fallback
    //                  produced multi-day events (TimelineCard renders, but
    //                  editor knows the chronology was not LLM-extracted)
    timeline_disposition:      "absent",
    primary_entities_enriched: [],
    factual_conflicts:         [],
    visual_concepts:           [],
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
    { "name": "Display Name", "type": "person|place|org", "role": "their role in this story (≤ 6 words)", "context": "One-sentence bio or context (≤ 30 words). Optional — null if unknown.", "phonetic": "LOO-lah da SEEL-vah — hyphenated syllables for TTS. Optional, omit for unambiguous English names." }
  ],
  "factual_conflicts": [
    { "claim": "what the conflicting sources disagree about (≤ 8 words)",
      "values": ["value as reported by source A (issuer)", "value as reported by source B (issuer)"],
      "preferred": "the value you would lead with, must match one of \`values\` verbatim" }
  ],
  "visual_concepts": [
    "Manhattan federal courthouse exterior",
    "FTX logo with customer-fund flow diagram",
    "Defendant's mugshot, DOJ-public domain"
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
- visual_concepts: 3-5 concrete visuals a renderer can map to module beats — proper-noun places, recognisable logos, named figures, charts. Each entry ≤ 80 characters.
  - Skip generic stock-photo concepts ("a courtroom", "a businessman in a suit"). Specificity is the whole point.
  - Empty array if the story has no obvious visual hooks beyond what's already implied by primary_entities and primary_geos.
- entity phonetic: only emit for non-English names or names where the spelling misleads English TTS (e.g. "Lula" → "LOO-lah", "Xi Jinping" → "SHEE jin-PING"). Use simple hyphenated syllables in caps for stressed parts. Omit for names that English TTS will read correctly.
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
  out.visual_concepts    = sanitiseVisualConcepts(input.visual_concepts);

  // P3-4 — enforce timeline quality. Single-day timelines (story 170:
  // 11 articles across Apr 18-25, LLM extracted 2 events both Apr 18) are
  // worse than no timeline. Try the article-date fallback before giving up.
  ({ events: out.timeline_events, disposition: out.timeline_disposition } =
    enforceTimelineQuality(out.timeline_events, articles));

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

  return dedupStructuredNumbersAcrossBuckets(result);
}

// P3-2/P3-3 — when the same numeric `value` appears in multiple buckets and
// the labels overlap on a casualty-flavoured token (dead, killed, casualties,
// crew, victims, fatalities), collapse to one entry and prefer the
// `casualties` bucket. Story 170 had `104` in both `counts` ("104 crew
// members") and `casualties` ("104 dead") for the same warship-strike toll —
// NumberCard would otherwise double-render.
//
// Conservative heuristic: only collapse when (a) value matches exactly and
// (b) the labels share a casualty marker. A `25` in counts ("25 years") and
// `25` in money ("25 million") for unrelated facts will NOT collapse —
// different domains, different label vocab.
const CASUALTY_LABEL_TOKENS = Object.freeze([
  "dead", "deaths", "killed", "casualty", "casualties", "fatality", "fatalities",
  "victim", "victims", "wounded", "injured", "missing",
  // Story 170's specific case: "crew members" lands in counts paired with
  // "104 dead" in casualties for the same ship-strike toll.
  "crew",
]);

function labelTokens(entry) {
  return [entry?.label, entry?.role]
    .filter((s) => typeof s === "string")
    .join(" ")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function entryHasCasualtyMarker(entry) {
  const tokens = labelTokens(entry);
  return tokens.some((t) => CASUALTY_LABEL_TOKENS.includes(t));
}

function dedupStructuredNumbersAcrossBuckets(buckets) {
  // Walk every non-casualties bucket; if an entry's value matches a
  // casualties entry AND both carry a casualty-flavoured label token,
  // drop the non-casualties duplicate. The casualties entry stays.
  const casualties = buckets.casualties ?? [];
  if (casualties.length === 0) return buckets;

  const casualtyValues = new Set();
  for (const c of casualties) {
    if (entryHasCasualtyMarker(c)) casualtyValues.add(c.value);
  }
  if (casualtyValues.size === 0) return buckets;

  for (const bucketName of ["money", "counts", "percentages", "magnitudes"]) {
    const bucket = buckets[bucketName];
    if (!Array.isArray(bucket) || bucket.length === 0) continue;
    buckets[bucketName] = bucket.filter((entry) => {
      if (!casualtyValues.has(entry.value)) return true;
      return !entryHasCasualtyMarker(entry);
    });
  }
  return buckets;
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

// P3-4 — timeline quality gate.
//
// After the LLM-extraction pass and validator, count distinct dates in the
// timeline. If we have ≥2, the timeline is healthy — render. If we have ≤1,
// try a fallback: derive events from `articles[i].published_at + title`
// (one event per distinct publication date). If the fallback yields ≥2
// distinct dates, replace the LLM's thin output with article-derived events
// and mark the disposition `fallback` so the editor can see what happened.
// If even the fallback can't produce multi-day events, mark `single_day`
// (one event total) or `absent` (zero) — the renderer can decide whether
// to suppress TimelineCard.
const TIMELINE_FALLBACK_MAX = 5;
const TIMELINE_FALLBACK_LABEL_MAX = 60;

export function enforceTimelineQuality(events, articles) {
  const safeEvents = Array.isArray(events) ? events : [];
  const distinctDates = new Set(safeEvents.map((e) => e?.date).filter(Boolean));

  if (distinctDates.size >= 2) {
    return { events: safeEvents, disposition: "multi_day" };
  }

  // LLM thin / single-day. Try article-date fallback.
  const fallback = deriveTimelineFromArticles(articles);
  const fallbackDates = new Set(fallback.map((e) => e.date));

  if (fallbackDates.size >= 2) {
    return { events: fallback, disposition: "fallback" };
  }

  // Both thin. Honest signal so the renderer can decide.
  if (distinctDates.size === 1 || safeEvents.length > 0) {
    return { events: safeEvents, disposition: "single_day" };
  }
  return { events: [], disposition: "absent" };
}

function deriveTimelineFromArticles(articles) {
  if (!Array.isArray(articles) || articles.length === 0) return [];

  // Group by YYYY-MM-DD; pick the most authoritative title per date so the
  // event label is the strongest available headline rather than a wire pickup.
  const byDate = new Map();
  for (const a of articles) {
    if (!a?.published_at) continue;
    const date = String(a.published_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const authority = Number.isFinite(a.authority_score) ? a.authority_score : 0;
    const existing = byDate.get(date);
    if (!existing || authority > existing.authority) {
      byDate.set(date, {
        date,
        title:     typeof a.title === "string" ? a.title.trim() : "",
        source_id: Number.isFinite(Number(a.id)) ? Number(a.id) : null,
        authority,
      });
    }
  }

  // Sort newest-first (timeline reads top-down chronologically descending);
  // truncate label to keep the renderer's TimelineCard readable.
  return [...byDate.values()]
    .filter((e) => e.title.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, TIMELINE_FALLBACK_MAX)
    .map((e) => ({
      date:      e.date,
      label:     e.title.length > TIMELINE_FALLBACK_LABEL_MAX
                   ? e.title.slice(0, TIMELINE_FALLBACK_LABEL_MAX - 1).replace(/\s+\S*$/, "") + "…"
                   : e.title,
      source_id: e.source_id,
    }));
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
    if (typeof e.role     === "string" && e.role.trim())     out.role     = e.role.trim().slice(0, 80);
    if (typeof e.context  === "string" && e.context.trim())  out.context  = e.context.trim().slice(0, 280);
    // P2-7 — phonetic hint for TTS. Optional, only emitted by the LLM for
    // non-English names. Reject anything that doesn't look like a phonetic
    // syllabification: must contain at least one hyphen or whitespace
    // separator, otherwise it's just the name retyped (no value over the
    // raw `name` field) and would mislead the renderer's substitution layer.
    if (typeof e.phonetic === "string") {
      const phon = e.phonetic.trim().slice(0, 80);
      if (phon && /[\s-]/.test(phon) && phon.toLowerCase() !== out.name.toLowerCase()) {
        out.phonetic = phon;
      }
    }
    return out;
  }, 8);
}

// P2-1 — visual concepts. Free-form short strings; we cap length and count
// but don't try to enforce specificity beyond rejecting empties / dupes —
// the prompt does that work, and the editor sees the list before render.
function sanitiseVisualConcepts(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const item of input) {
    if (out.length >= 5) break;
    if (typeof item !== "string") continue;
    const trimmed = item.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
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
