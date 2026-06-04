// Canonical per-category presentation data for the social pipeline.
//
// azure-functions is deployed WITHOUT config/ on the path, so config/categories.js
// cannot be imported here. Before this module, several social files independently
// keyed maps on category_id and drifted out of sync (card-renderer's accent map
// was missing `ai`; the hashtag map listed it). This is the single local source
// of truth for category presentation in social — keep the ids in sync with
// config/categories.js, and add new verticals here once.
//
//   accent   — chip/accent colour used by card-renderer
//   hashtags — curated IG hashtag block for the vertical (see _hashtags.js)

export const SOCIAL_CATEGORIES = {
  world:   { accent: "#2563EB", hashtags: ["#WorldNews"] },
  tech:    { accent: "#7C3AED", hashtags: ["#Tech", "#Technology"] },
  finance: { accent: "#059669", hashtags: ["#Finance", "#Markets"] },
  culture: { accent: "#DB2777", hashtags: ["#Culture", "#Entertainment"] },
  science: { accent: "#D97706", hashtags: ["#Science"] },
  ai:      { accent: "#0EA5E9", hashtags: ["#AI"] },
};

// Accent for an unknown/blank category id.
export const DEFAULT_ACCENT = "#1D4ED8";

export function accentFor(categoryId) {
  return SOCIAL_CATEGORIES[categoryId]?.accent || DEFAULT_ACCENT;
}
