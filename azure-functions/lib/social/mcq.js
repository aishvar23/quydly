// Shared helpers for the multiple-choice quiz questions the social pipeline
// generates from an LLM (IG carousel engagement slide, IG "why it matters"
// sibling, X quiz tweet). Extracted so the validation + JSON-extraction logic
// lives in ONE place instead of being copy-pasted across each platform module.

// True iff `q` is a usable MCQ: a non-empty `question` string, an `options`
// array of EXACTLY 4 non-empty strings, and a `correctIndex` integer in 0–3.
// Semantics are identical to the per-platform checks this replaced — callers
// that need extra fields (e.g. X's `tldr`) AND this on top of it.
export function validateMCQ(q) {
  return !!(
    q &&
    typeof q.question === "string" && q.question.trim() &&
    Array.isArray(q.options) && q.options.length === 4 &&
    q.options.every((o) => typeof o === "string" && o.trim()) &&
    Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3
  );
}

// Parse a JSON object out of an LLM text response, tolerating a ```json fenced
// block. Mirrors the exact behaviour the platform modules used inline: trim,
// strip a leading ``` / ```json, strip a trailing ```, trim, then JSON.parse.
// Throws (like JSON.parse) on malformed input — callers wrap in try/catch.
export function parseJSONFromLLM(text) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(raw);
}
