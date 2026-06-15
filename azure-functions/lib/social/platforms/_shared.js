// Shared, pure helpers for the platform formatters (X / Facebook / Instagram).
// No I/O, no LLM — deterministic text shaping from a synthesized story.

export const QUYDLY_URL = () => process.env.QUYDLY_URL || "quydly.com";

// Collect entity names from a story: typed enriched entities first, then the
// flat primary_entities array. Untyped enriched entities always pass (legacy
// rows pre-enrichment have no type); `allowedTypes` (when given) further
// restricts which typed entities are kept.
//
// NOTE: the flat primary_entities array carries NO type, so `allowedTypes`
// cannot be applied to it — and on the enrichment-failure path it holds the
// dirty, regex-extracted cluster names (e.g. "correspondent", "two india";
// see story-synthesizer cleanPrimaryEntities). Callers that need a clean,
// type-filtered set (hashtags) pass `{ includeFlat: false }`; callers that
// gate names downstream and want maximum recall (cashtags, where the ticker
// map rejects non-companies) keep the default flat fallback.
export function entityNames(story, allowedTypes = null, { includeFlat = true } = {}) {
  const names = [];
  const enriched = Array.isArray(story?.primary_entities_enriched) ? story.primary_entities_enriched : [];
  for (const e of enriched) {
    if (e && e.name && (!e.type || !allowedTypes || allowedTypes.includes(e.type))) names.push(e.name);
  }
  if (!includeFlat) return names;
  const flat = Array.isArray(story?.primary_entities) ? story.primary_entities : [];
  for (const n of flat) if (typeof n === "string") names.push(n);
  return names;
}

// stories.key_points is jsonb — usually string[], occasionally [{text}].
export function keyPointStrings(story) {
  const kp = story && story.key_points;
  if (!Array.isArray(kp)) return [];
  return kp
    .map((p) => (typeof p === "string" ? p : p && (p.text || p.point)) || "")
    .map((s) => String(s).trim())
    .filter(Boolean);
}

// First N sentences of a blob, whitespace-normalised.
export function firstSentences(text, n = 1) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  const parts = clean.match(/[^.!?]+[.!?]+/g);
  if (!parts) return clean;
  return parts.slice(0, n).join(" ").trim();
}

// Hard cap that never splits mid-word and adds an ellipsis when it cuts.
export function truncate(text, max) {
  const s = String(text);
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

export function bullets(items, marker = "•") {
  return items.map((i) => `${marker} ${i}`).join("\n");
}

export function numbered(items) {
  return items.map((i, idx) => `${idx + 1}. ${i}`).join("\n");
}

// Assemble blocks separated by blank lines, dropping empties, capped to `max`.
// Adds blocks greedily and stops before exceeding the cap so the CTA (passed
// last) is preserved when possible.
export function assemble(blocks, max) {
  const parts = [];
  let length = 0;
  for (const block of blocks) {
    if (!block) continue;
    const add = (parts.length ? 2 : 0) + block.length; // 2 = "\n\n"
    if (length + add > max) continue;
    parts.push(block);
    length += add;
  }
  return parts.join("\n\n");
}

// Append a labelled block of whole items to a caption, separated from the body
// by a blank line and capped to `maxLength`. Items are joined by `joiner`; an
// optional `header` sits on its own first line, after which every item is led by
// `joiner`. With no header the first item follows the separator directly and
// only later items are led. Greedily fits as many WHOLE items as the cap allows
// — never splits an item, never truncates the body — and returns the body
// unchanged when nothing (or no body+item) fits.
//
// Powers the IG caption blocks appended downstream of validation: the hashtag
// block (no header, space-joined) and the source block (header "Sources:",
// newline-joined). Pure — callers pass maxLength (e.g. CONSTRAINTS.maxLength) so
// this stays free of any platform import.
export function appendBlock(text, items, { header = "", joiner = " ", maxLength = Infinity } = {}) {
  const body = String(text || "");
  if (!items.length) return body;
  const sep = body ? "\n\n" : ""; // no leading separator when there is no body
  // fixed = body + blank-line separator + the header line (empty when none).
  const fixed = body.length + sep.length + header.length;
  const fitted = [];
  let runLen = 0;
  for (const item of items) {
    const needsLead = header.length > 0 || fitted.length > 0;
    const addition = (needsLead ? joiner.length : 0) + item.length;
    if (fixed + runLen + addition > maxLength) break;
    fitted.push(item);
    runLen += addition;
  }
  if (!fitted.length) return body;
  const lead = header ? joiner : ""; // header → first item starts on its own line
  return `${body}${sep}${header}${lead}${fitted.join(joiner)}`;
}
