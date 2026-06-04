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
// Source of names: stories.primary_entities_enriched (typed) + primary_entities,
// read via the shared entityNames() helper the cashtag module also uses. Kept
// conservative: a wrong/junk tag is worse than one fewer tag.

import { entityNames } from "./_shared.js";

// Instagram's caption hard cap (mirror instagram.js CONSTRAINTS.maxLength —
// duplicated here to avoid a circular import: instagram.js imports this module).
const IG_MAX_LENGTH = 1500;

// Always-on brand + ritual tags. Small set — they reinforce the daily-quiz habit
// and keep the brand discoverable without drowning the topical tags.
const BRAND_TAGS = ["#Quydly", "#NewsQuiz", "#DailyNews"];

// Curated category_id → vertical hashtag overrides. The ids mirror
// config/categories.js, but azure-functions is deployed without config/ on the
// path (card-renderer.js likewise keeps category data local), so they are
// restated here rather than imported. Any category NOT listed falls back to a
// tag derived from its id (see categoryTags), so a new/renamed category degrades
// to a generic tag instead of silently dropping its hashtag.
const CATEGORY_TAG_OVERRIDES = {
  world:   ["#WorldNews"],
  tech:    ["#Tech", "#Technology"],
  finance: ["#Finance", "#Markets"],
  culture: ["#Culture", "#Entertainment"],
  science: ["#Science"],
  ai:      ["#AI"],
};

// Hashtag(s) for a category id: the curated overrides when known, otherwise a
// single generic tag derived from the id (#Sports for "sports") so an unmapped
// category is never silently untagged. Empty only for a missing/blank id.
function categoryTags(categoryId) {
  if (!categoryId) return [];
  if (CATEGORY_TAG_OVERRIDES[categoryId]) return CATEGORY_TAG_OVERRIDES[categoryId];
  const id = String(categoryId);
  return [`#${id.charAt(0).toUpperCase()}${id.slice(1)}`];
}

// Turn an entity name into a single PascalCase hashtag, or null if unusable.
// "Sam Bankman-Fried" → "#SamBankmanFried"; "FTX" → "#FTX". Digits are stripped
// (a stray number could read as a factual claim) and very short/long names are
// dropped (initials, or run-on phrases that make ugly tags).
function entityTag(name) {
  const words = String(name || "")
    .replace(/[^A-Za-z0-9 ]/g, " ") // drop punctuation, keep word boundaries
    .replace(/\d+/g, "")            // strip digits — no numeric claims in a tag
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const pascal = words.join("");
  if (pascal.length < 3 || pascal.length > 30) return null;
  return `#${pascal}`;
}

// Ordered, deduped (case-insensitive) hashtag list for a story: category +
// entity + brand tags, capped at `max`. Topical tags come first so that if the
// cap trims anything, it trims the always-available brand tags last.
export function hashtagsFor(story, { maxEntities = 3, max = 8 } = {}) {
  const seen = new Set();
  const out = [];
  const push = (tag) => {
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push(tag);
  };

  for (const tag of categoryTags(story?.category_id)) push(tag);

  let entityCount = 0;
  for (const name of entityNames(story, ["person", "org", "place"])) {
    if (entityCount >= maxEntities) break;
    const tag = entityTag(name);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    push(tag);
    entityCount++;
  }

  for (const tag of BRAND_TAGS) push(tag);

  return out;
}

// Append the hashtag block to a caption, separated by a blank line, staying
// within IG's caption cap. Adds as many whole tags as fit (never splits a tag,
// never truncates the caption body); returns the caption unchanged if even one
// tag would not fit.
export function appendHashtags(text, story, opts = {}) {
  const max = opts.maxLength ?? IG_MAX_LENGTH;
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

export { BRAND_TAGS, CATEGORY_TAG_OVERRIDES, categoryTags, entityTag };
