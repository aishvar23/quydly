// Video eligibility gate (P2-3).
//
// Pre-flagged at synthesis time so the editor / video pipeline can batch-
// approve or batch-skip without re-deriving the same rule chain at render.
// `video-pipeline-v2`'s audit step still runs on its own concerns
// (visual angle, narration tone), but eligibility belongs upstream — once
// per story, deterministic, queryable from the column.
//
// Pure function, no I/O. First-match-wins on the reason field so the
// editor sees the most specific reason a story was excluded.
//
// Rules (in order):
//   1. confidence_score < CONFIDENCE_FLOOR  → "low_confidence"
//   2. articles.length === 0                → "no_articles"
//   3. posture = breaking_developing AND
//      domain_count < 2                     → "developing_single_source"
//   4. diversity.label === "single"          → "single_source_coverage"
//   5. headline/summary trips a sensitive-
//      subject phrase                       → "sensitive_subject"
//   6. primary_entities populated but
//      primary_entities_enriched empty
//      (and story_type != finance_markets)  → "no_enriched_entities"
//   7. ≥2 primary_geos but all
//      source_documents source_country
//      collapse to one country NOT in
//      primary_geos                         → "single_country_outside_theatre"
//   8. row carries no resolved enriched
//      entity AND no primary_geos AND
//      <2 visual_concepts                   → "visual_starvation"
//   9. otherwise                             → eligible: true
//
// Rules 6 and 7 added 2026-05-09 from the v2 video-pipeline learning record:
//   - story 181 root cause was 100% placeholder renders because synth emitted
//     primary_entities but left primary_entities_enriched=[]. With no enriched
//     entries the renderer's asset-fetch layer can't resolve a Wikipedia
//     pageimage for any module — every module ships visually blank.
//   - story 222 (Trump/Iran/Pakistan) had 6/6 India-domiciled outlets covering
//     a story with no Indian primary actor; gate-3 source diversity passed by
//     domain count but the editorial perspective collapsed to one country
//     outside the theatre. Stage-2 video pipeline already proposed this gate;
//     we mirror it upstream so the row never reaches the video pipeline.

const CONFIDENCE_FLOOR = 7;

// Conservative phrase list — strong-signal markers that warrant editor
// review before the story renders. False-positive rate matters here:
// every excluded story is one fewer video, but every false-negative is a
// trust hit. Bias toward "skip and let editor override" rather than
// "render and hope the audit catches it".
//
// Keep entries lowercased. The matcher does substring lookup against the
// lowercased headline + summary.
const SENSITIVE_PHRASES = Object.freeze([
  // Self-harm — ALWAYS skip. ElevenLabs / generic narration on these is
  // wildly inappropriate without editorial framing.
  "suicide",
  "self-harm",
  "took his own life",
  "took her own life",
  "took their own life",

  // Sexual assault detail in body — high risk of mishandled narration.
  "rape",
  "sexual assault",
  "sexual abuse",
  "child abuse",
  "child sexual",

  // Named-minor risk markers. Synthesizer doesn't reliably tag minors,
  // so the heuristic is "any time the article mentions a child or minor
  // by name, defer to the editor". Catches a lot of true positives;
  // false positives here are tolerable.
  "child victim",
  "named the minor",
  "12-year-old",
  "13-year-old",
  "14-year-old",
  "15-year-old",
  "16-year-old",
  "minor identified as",

  // Active mass-casualty events with naming. The story may render fine
  // editorially, but synthesis-time auto-render is the wrong default.
  "mass shooting",
  "mass casualty",
  "school shooting",
]);

/**
 * Compute the eligibility verdict for one story.
 *
 * @param {{
 *   confidence_score: number,
 *   editorial_posture: string|null,
 *   headline: string,
 *   summary: string,
 *   diversity: { label: string|null, domain_count: number },
 *   article_count: number,
 *   story_type?: string|null,
 *   primary_entities?: Array<string>,
 *   primary_entities_enriched?: Array<{ name?: string, type?: string, wiki_resolved?: boolean }>,
 *   primary_geos?: Array<string>,
 *   source_documents?: Array<{ source_country?: string|null }>,
 *   visual_concepts?: Array<string>,
 * }} input
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function computeVideoEligibility(input) {
  const conf       = Number(input?.confidence_score);
  const posture    = typeof input?.editorial_posture === "string" ? input.editorial_posture : null;
  const articleN   = Number(input?.article_count);
  const divLabel   = input?.diversity?.label ?? null;
  const domainN    = Number(input?.diversity?.domain_count);
  const haystack   = [input?.headline, input?.summary]
    .filter((s) => typeof s === "string")
    .join(" ")
    .toLowerCase();

  if (!Number.isFinite(conf) || conf < CONFIDENCE_FLOOR) {
    return { eligible: false, reason: "low_confidence" };
  }
  if (!Number.isFinite(articleN) || articleN === 0) {
    return { eligible: false, reason: "no_articles" };
  }
  if (posture === "breaking_developing" && (!Number.isFinite(domainN) || domainN < 2)) {
    return { eligible: false, reason: "developing_single_source" };
  }
  if (divLabel === "single") {
    return { eligible: false, reason: "single_source_coverage" };
  }
  if (haystack && containsSensitivePhrase(haystack)) {
    return { eligible: false, reason: "sensitive_subject" };
  }

  // Gate 6 — no_enriched_entities. The synth gave us a list of named
  // entities but failed to enrich any of them; the renderer's asset-fetch
  // layer has no way to resolve a Wikipedia pageimage, so every module
  // ships visually blank. Exempt finance_markets (which leans on numeric
  // data plates rather than entity portraits). Only fires when both arrays
  // are explicitly provided — callers that don't pass them get the
  // pre-2026-05-09 behaviour so existing tests stay green.
  const primaryEntities = Array.isArray(input?.primary_entities) ? input.primary_entities : null;
  const enriched        = Array.isArray(input?.primary_entities_enriched) ? input.primary_entities_enriched : null;
  const storyType       = typeof input?.story_type === "string" ? input.story_type : null;
  if (
    primaryEntities !== null
    && primaryEntities.length > 0
    && enriched !== null
    && enriched.length === 0
    && storyType !== "finance_markets"
  ) {
    return { eligible: false, reason: "no_enriched_entities" };
  }

  // Gate 7 — single_country_outside_theatre. Multi-country story (≥2 named
  // primary_geos) whose entire source set sits in one country that is NOT
  // among the named theatre countries. The editorial perspective collapses
  // to that one country regardless of how many distinct domains the row
  // shows — domain diversity overstates source independence.
  const geos = Array.isArray(input?.primary_geos)
    ? input.primary_geos.filter((g) => typeof g === "string" && g.trim()).map((g) => g.trim().toLowerCase())
    : null;
  const docs = Array.isArray(input?.source_documents) ? input.source_documents : null;
  if (geos !== null && geos.length >= 2 && docs !== null && docs.length > 0) {
    const sourceCountries = new Set();
    for (const d of docs) {
      const c = typeof d?.source_country === "string" ? d.source_country.trim().toLowerCase() : "";
      if (c) sourceCountries.add(c);
    }
    if (sourceCountries.size === 1) {
      const only = [...sourceCountries][0];
      if (!geos.includes(only)) {
        return { eligible: false, reason: "single_country_outside_theatre" };
      }
    }
  }

  // Gate 8 — visual_starvation. Hard backstop for the playbook §1 visual
  // asset rule of thumb: every module needs a real image, sourced from a
  // resolved person/place portrait, a country flag, a concept stock asset,
  // or a numeric data plate. A row that has none of those three metadata
  // sources cannot satisfy the rule for any module — placeholders are
  // guaranteed. Better to skip than to ship visually blank.
  //
  // Triggers when ALL of:
  //   - no enriched entity has wiki_resolved === true (priority 1 unavailable)
  //   - primary_geos is empty (priority 2 unavailable)
  //   - fewer than 2 visual_concepts (priority 3 thin)
  //
  // Numeric data plates (priority 4) are a per-module fallback but cannot
  // carry a whole video on their own, so they are not part of the gate.
  // Like gates 6/7, this only fires when callers actually pass the fields.
  const enrichedForVisual = Array.isArray(input?.primary_entities_enriched) ? input.primary_entities_enriched : null;
  const geosForVisual     = Array.isArray(input?.primary_geos) ? input.primary_geos : null;
  const conceptsForVisual = Array.isArray(input?.visual_concepts) ? input.visual_concepts : null;

  if (enrichedForVisual !== null && geosForVisual !== null && conceptsForVisual !== null) {
    const hasResolvedPortrait = enrichedForVisual.some(
      (e) => e?.wiki_resolved === true &&
        (e?.wikipedia_thumbnail_url || e?.portrait_thumbnail_url || e?.portrait_image_url),
    );
    const hasGeoFlag          = geosForVisual.some((g) => typeof g === "string" && g.trim());
    const hasConceptStock     = conceptsForVisual.filter((c) => typeof c === "string" && c.trim()).length >= 2;
    if (!hasResolvedPortrait && !hasGeoFlag && !hasConceptStock) {
      return { eligible: false, reason: "visual_starvation" };
    }
  }

  return { eligible: true, reason: null };
}

function containsSensitivePhrase(haystack) {
  for (const phrase of SENSITIVE_PHRASES) {
    if (haystack.includes(phrase)) return true;
  }
  return false;
}

export const SENSITIVE_PHRASES_FOR_TEST = SENSITIVE_PHRASES;
export const CONFIDENCE_FLOOR_FOR_TEST  = CONFIDENCE_FLOOR;
