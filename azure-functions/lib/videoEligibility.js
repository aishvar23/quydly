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
//   6. otherwise                             → eligible: true

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
