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
// Must match stories.category_id values (the pipeline uses "technology", not "tech";
// "world" is intentionally excluded — it needs a keyword scan).
export const SAFE_CATEGORIES = new Set(["science", "technology", "culture", "finance"]);

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

// Count distinct source domains for a story. Prefers `source_documents`
// (jsonb array of {domain}|{url}); falls back to `source_count` when that
// detail isn't present. Used by the auto-approval gate (§10.3 unique_domains).
export function countSourceDomains(story) {
  const docs = story && story.source_documents;
  if (Array.isArray(docs) && docs.length) {
    const domains = new Set();
    for (const d of docs) {
      if (!d) continue;
      if (typeof d === "string") { domains.add(d); continue; }
      const dom = d.domain || d.source_domain ||
        (d.url ? String(d.url).replace(/^https?:\/\//, "").split("/")[0] : null);
      if (dom) domains.add(String(dom).toLowerCase());
    }
    if (domains.size) return domains.size;
  }
  return Number(story && story.source_count) || 0;
}

// Phase 5 auto-approval gate (§10.3). A post may be auto-approved ONLY when the
// story is demonstrably low-risk AND high-quality AND in a safe category.
// Returns { eligible, reasons } — reasons lists every failing condition so the
// decision is auditable. This is the sole authority for auto-approval; the
// publish toggle (SOCIAL_AUTO_PUBLISH_ENABLED) and per-day cap are enforced by
// the caller.
//
//   flags = FLAGS.social.autoApprove
export function evaluateAutoApproval(story, { flags }) {
  const reasons = [];

  // Hard block: anything not classified LOW can never auto-approve (§10.1/§15.5).
  const sensitivity = classifySensitivity(story);
  if (sensitivity !== SENSITIVITY.LOW) {
    reasons.push(`sensitivity=${sensitivity} (must be LOW)`);
  }

  const confidence = Number(story.confidence_score) || 0;
  if (confidence < flags.minConfidence) {
    reasons.push(`confidence ${confidence} < ${flags.minConfidence}`);
  }

  const score = Number(story.story_score) || 0;
  if (score < flags.minStoryScore) {
    reasons.push(`story_score ${score} < ${flags.minStoryScore}`);
  }

  const domains = countSourceDomains(story);
  if (domains < flags.minUniqueDomains) {
    reasons.push(`unique_domains ${domains} < ${flags.minUniqueDomains}`);
  }

  const category = story.category_id || story.category;
  if (!category || !flags.safeCategories.includes(category)) {
    reasons.push(`category "${category}" not in safe list`);
  }

  return { eligible: reasons.length === 0, reasons };
}
