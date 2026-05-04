'use strict';

// Generic text/number extraction helpers shared by all story types.
// Anything story-type-specific stays in the per-type file.

// Concatenate the story's textual surfaces into a single search corpus.
function collectText(story) {
  return [
    story.headline,
    story.summary,
    ...(story.key_points || []),
  ].filter(Boolean).join(' ');
}

// Case-insensitive whole-word match against a candidate list. Avoids
// substring false positives ("Special" → "CIA") with non-word boundaries
// at both ends.
function uniqueMatches(text, candidates) {
  const hits = [];
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, 'i');
    if (pattern.test(text) && !hits.find((h) => h.toLowerCase() === candidate.toLowerCase())) {
      hits.push(candidate);
    }
  }
  return hits;
}

// Pull dollar figures out of free text. Case-insensitive on suffix words.
// Word boundary on the unit prevents "$400,000 betting" → "$400,000 b".
function extractMoney(text) {
  const matches = String(text).match(/\$[\d,.]+(?:\s*(?:million|billion|thousand|[mbk])\b)?/gi) || [];
  const cleaned = matches.map((s) => s.trim().replace(/\.+$/, ''));
  return dedupeAmounts(Array.from(new Set(cleaned)));
}

// Collapse equivalent amounts. Prefer the longer/more formal version
// over the shorthand: ["$400K", "$400,000"] → ["$400,000"].
function dedupeAmounts(amounts) {
  const groups = new Map();
  for (const amount of amounts) {
    const value = parseAmount(amount);
    if (!Number.isFinite(value) || value === 0) continue;
    const existing = groups.get(value);
    if (!existing || amount.length > existing.length) {
      groups.set(value, amount);
    }
  }
  return Array.from(groups.values());
}

// Money string → numeric value. Digit-adjacent suffix avoids false matches
// (e.g. won't grab "back" or "Klingon").
function parseAmount(display) {
  if (!display) return 0;
  const cleaned = String(display).replace(/[^0-9.]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  if (/\d\s*(?:billion|b)\b/i.test(display)) return value * 1e9;
  if (/\d\s*(?:million|m)\b/i.test(display)) return value * 1e6;
  if (/\d\s*(?:thousand|k)\b/i.test(display)) return value * 1e3;
  return value;
}

function indexSegments(segments) {
  return (segments || []).reduce((map, item) => {
    if (item && item.role) map[item.role] = item.text;
    return map;
  }, {});
}

function cap(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Render-friendly month-day-year: "May 3, 2026". Matches the common
// source-doc date format so TimelineCard events read consistently
// across the published_at row and source filings.
function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const MONTHS = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'];
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch (_) {
    return iso;
  }
}

// Whole-word substring check. text.includes('accord') would match
// "according to"; this would not. Use this in matches() routing so
// keywords don't bleed into unrelated text.
function wordIncludes(text, keyword) {
  if (!keyword) return false;
  const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

// Defang any in-content marker strings so a hostile fixture cannot close
// the prompt's untrusted-data boundary tags and inject instructions.
function safeForPrompt(s) {
  return String(s)
    .replace(/===EVIDENCE_PACKAGE_(BEGIN|END)===/g, '===_evidence_package_$1_===')
    .replace(/===AUDIT_(BEGIN|END)===/g, '===_audit_$1_===');
}

module.exports = {
  collectText,
  uniqueMatches,
  wordIncludes,
  extractMoney,
  dedupeAmounts,
  parseAmount,
  indexSegments,
  cap,
  formatDate,
  safeForPrompt,
};
