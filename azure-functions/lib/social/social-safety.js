// Social safety / sensitivity classification.
//
// Pure, dependency-free helpers used by the candidate selector (Phase 1) and the
// auto-publish gate (Phase 5). The classifier maps a synthesized story to one of
// LOW / MEDIUM / HIGH / UNKNOWN so the rest of the pipeline can decide whether a
// post may ever be auto-approved or must go through human review.
//
// Reference: design doc §10.1 (sensitive categories) and §10.3 (auto-approval).

export const SENSITIVITY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  UNKNOWN: "UNKNOWN",
};

// Categories that are inherently low brand-risk when no sensitive signal is found.
// Matches config/categories.js ids (world is intentionally excluded — it needs a scan).
export const SAFE_CATEGORIES = new Set(["science", "tech", "culture", "finance"]);

// HIGH — must always go through human review (§10.1 sensitive categories +
// §10.2 auto-reject signals). Word-boundary matched, case-insensitive.
const HIGH_RISK_TERMS = [
  "war", "warfare", "invasion", "airstrike", "air strike", "missile", "shelling",
  "terror", "terrorism", "terrorist", "militant", "insurgent",
  "killed", "killing", "dead", "death", "died", "fatal", "casualty", "casualties", "massacre",
  "genocide", "atrocity", "execution", "executed",
  "murder", "homicide", "manslaughter", "stabbing", "shooting", "gunman", "shooter",
  "rape", "sexual assault", "molest", "trafficking",
  "child abuse", "child harm", "abuse",
  "crime", "criminal", "arrested", "indicted", "charged with", "convicted",
  "lawsuit", "sued", "allegation", "alleged", "accused", "defamation",
  "communal", "sectarian", "riot", "lynching",
  "suicide", "self-harm", "overdose",
  "bomb", "bombing", "explosion", "blast", "hostage", "kidnap", "kidnapping", "abduct", "abduction",
];

// MEDIUM — allowed but never auto-approved (advice / persuasion / belief topics).
const MEDIUM_RISK_TERMS = [
  "election", "ballot", "vote", "referendum", "campaign rally", "candidate",
  "religion", "religious", "church", "mosque", "temple", "clergy",
  "vaccine", "diagnosed", "diagnosis", "treatment", "symptom", "prescription", "clinical",
  "medical advice", "cure", "disease outbreak",
  "investment", "stock tip", "crypto", "financial advice", "trading", "portfolio",
  "abortion", "immigration raid", "protest",
];

function buildBlob(story) {
  if (!story || typeof story !== "object") return "";
  const parts = [story.headline, story.summary, story.hook_sentence, story.why_it_matters];

  const kp = story.key_points;
  if (Array.isArray(kp)) {
    for (const point of kp) {
      if (typeof point === "string") parts.push(point);
      else if (point && typeof point === "object") parts.push(point.text || point.point || "");
    }
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matchesAny(blob, terms) {
  for (const term of terms) {
    // Word-boundary for single tokens; substring for multi-word phrases.
    if (term.includes(" ")) {
      if (blob.includes(term)) return true;
    } else {
      // Whole word + common inflections (plural / -ed / -ing). No bare "-d" so
      // "war" can't match "ward", and the trailing \b stops "warm"/"warranty".
      const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}(?:s|es|ed|ing)?\\b`, "i");
      if (re.test(blob)) return true;
    }
  }
  return false;
}

// classifySensitivity(story) → 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
//
// Highest matched level wins. A safe-category story with no sensitive signal is
// LOW; a story in an unmapped category with no signal is UNKNOWN (conservative —
// never auto-approved).
export function classifySensitivity(story) {
  const blob = buildBlob(story);
  if (!blob) return SENSITIVITY.UNKNOWN;

  if (matchesAny(blob, HIGH_RISK_TERMS)) return SENSITIVITY.HIGH;
  if (matchesAny(blob, MEDIUM_RISK_TERMS)) return SENSITIVITY.MEDIUM;

  const category = story.category_id || story.category;
  if (category && SAFE_CATEGORIES.has(category)) return SENSITIVITY.LOW;

  return SENSITIVITY.UNKNOWN;
}

// Convenience guard for Phase 5 — a story may only ever be auto-approved if LOW.
export function isSensitive(story) {
  return classifySensitivity(story) !== SENSITIVITY.LOW;
}
