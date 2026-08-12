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

// Extract the first balanced top-level JSON object from `text`, string-aware
// (respects quotes and backslash escapes), or null when no object closes.
// Used ONLY after a direct JSON.parse fails: the model sometimes wraps the JSON
// in prose ("Looking at this story… { … }") or appends text after the closing
// brace — both observed live on 2026-07-24 (social_why_it_matters_failed /
// illustration_scenes_failed), where they silently degraded IG carousels.
function firstJSONObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Parse a JSON object out of an LLM text response, tolerating a ```json fenced
// block: trim, strip a leading ``` / ```json, strip a trailing ```, trim, then
// JSON.parse. When THAT parse throws a SyntaxError (malformed JSON — the model
// wrapped the object in prose or appended trailing text), fall back to parsing
// the first balanced JSON object found in the text. The fallback is gated to
// SyntaxError specifically — any other failure surfaces unchanged — and the
// original error is rethrown when no distinct balanced object exists.
// Throws (like JSON.parse) on input with no parsable object — callers wrap in
// try/catch.
export function parseJSONFromLLM(text) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const extracted = firstJSONObject(raw);
    if (extracted === null || extracted === raw) throw err;
    return JSON.parse(extracted);
  }
}
