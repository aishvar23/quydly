// Hashtag derivation for Instagram captions. Design §8.3 (reach).
//
// Unlike X — where hashtags carry a spam penalty and stay off — Instagram treats
// hashtags as a primary discovery surface. We append a small, curated block to
// each IG caption built from three sources, most-specific first:
//
//   1. CATEGORY  — one or two evergreen tags for the story's vertical (#Tech …)
//   2. ENTITY    — up to a few PascalCased people/orgs/places from the story so a
//                  post about a trending subject rides that subject's tag feed
//   3. BRAND     — always-on ritual tags that reinforce the daily quiz (#Quydly …)
//
//   hashtagsFor(story, { maxEntities, max }) → ["#Tech", "#DonaldTrump", "#Quydly", …]
//   appendHashtags(text, story, opts)        → caption + "\n\n#a #b #c" (within cap)
//
// Entity names come from the shared entityNames() helper with { includeFlat:
// false } — only typed (person/org/place) enriched entities, never the dirty
// flat primary_entities fallback — so an enrichment-failure story can never leak
// junk like "#TwoIndia" into a caption. Kept conservative: a wrong/junk tag is
// worse than one fewer tag.

import { entityNames } from "./_shared.js";
import { CONSTRAINTS } from "./instagram.js";
import { SOCIAL_CATEGORIES } from "../_categories.js";

// Instagram allows up to 30 hashtags per caption; never emit more regardless of
// what a caller requests. The functional default (`max` below) stays well under.
const IG_MAX_HASHTAGS = 30;

// Always-on brand + ritual tags. Small set — they reinforce the daily-quiz habit
// and keep the brand discoverable without drowning the topical tags.
const BRAND_TAGS = ["#Quydly", "#NewsQuiz", "#DailyNews"];

// Capitalise the first letter of a word, leaving the rest intact.
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// PascalCase the alphanumeric words of a string: punctuation becomes a word
// boundary and is dropped. "us-politics" → "UsPolitics"; "Sam Bankman-Fried" →
// "SamBankmanFried". Returns "" when nothing usable remains.
function pascalCase(s) {
  return String(s || "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(cap)
    .join("");
}

// Hashtag(s) for a category id: the curated tags when known (see _categories.js),
// otherwise a single sanitised tag derived from the id (#UsPolitics for
// "us-politics") so an unmapped category is never silently untagged AND never
// emits a malformed tag IG would truncate at a punctuation char. Empty only for
// a missing/blank/unsanitisable id.
function categoryTags(categoryId) {
  if (!categoryId) return [];
  const known = SOCIAL_CATEGORIES[categoryId]?.hashtags;
  if (known) return known;
  const pascal = pascalCase(categoryId);
  return pascal ? [`#${pascal}`] : [];
}

// Turn an entity name into a single PascalCase hashtag, or null if unusable.
// "Sam Bankman-Fried" → "#SamBankmanFried"; "FTX" → "#FTX". Digits are stripped
// (a stray number could read as a factual claim) and very short/long names are
// dropped (initials, or run-on phrases that make ugly tags).
function entityTag(name) {
  const pascal = pascalCase(String(name || "").replace(/\d+/g, "")); // strip digits — no numeric claims in a tag
  if (pascal.length < 3 || pascal.length > 30) return null;
  return `#${pascal}`;
}

// Ordered, deduped (case-insensitive) hashtag list for a story: category +
// entity + brand tags, capped at `max` (and never above IG's 30-tag ceiling).
// Topical tags come first so that if the cap trims anything, it trims the
// always-available brand tags last.
export function hashtagsFor(story, { maxEntities = 3, max = 8 } = {}) {
  const limit = Math.min(max, IG_MAX_HASHTAGS);
  const seen = new Set();
  const out = [];
  // Returns true iff the tag was actually added (new + within cap).
  const push = (tag) => {
    if (!tag) return false;
    const key = tag.toLowerCase();
    if (seen.has(key) || out.length >= limit) return false;
    seen.add(key);
    out.push(tag);
    return true;
  };

  for (const tag of categoryTags(story?.category_id)) push(tag);

  let entityCount = 0;
  for (const name of entityNames(story, ["person", "org", "place"], { includeFlat: false })) {
    if (entityCount >= maxEntities || out.length >= limit) break;
    // Count only entities that actually produced a new tag, so maxEntities
    // bounds emitted tags rather than attempts.
    if (push(entityTag(name))) entityCount++;
  }

  for (const tag of BRAND_TAGS) push(tag);

  return out;
}

// Append the hashtag block to a caption, separated by a blank line, staying
// within IG's caption cap. Adds as many whole tags as fit (never splits a tag,
// never truncates the caption body); returns the caption unchanged if even one
// tag would not fit. The cap defaults to instagram.js CONSTRAINTS.maxLength —
// the same limit validatePost enforces on the body — so the appended block can
// never push a validated caption over the real platform limit.
export function appendHashtags(text, story, opts = {}) {
  const max = opts.maxLength ?? CONSTRAINTS.maxLength;
  const body = String(text || "");
  const tags = hashtagsFor(story, opts);
  if (!tags.length) return body;

  // No leading separator when there is no caption body to separate from.
  const sep = body ? "\n\n" : "";
  // Track the running length of the joined tag line instead of rebuilding the
  // whole candidate string each iteration (keeps this O(tags), not O(tags·body)).
  const fixed = body.length + sep.length;
  const fitted = [];
  let lineLen = 0;
  for (const tag of tags) {
    const addition = (fitted.length ? 1 : 0) + tag.length; // 1 = space separator
    if (fixed + lineLen + addition > max) break;
    fitted.push(tag);
    lineLen += addition;
  }
  if (!fitted.length) return body;
  return `${body}${sep}${fitted.join(" ")}`;
}

export { BRAND_TAGS, categoryTags, entityTag };
