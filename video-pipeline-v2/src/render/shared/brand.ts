export const BRAND = {
  name: "QUYDLY",
  bg: "#0A0A0A",
  surface: "#151515",
  surface2: "#222222",
  text: "#FFFFFF",
  muted: "#B5B5B5",
  dim: "#777777",
  width: 1080,
  height: 1920,
  fps: 30,
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
} as const;

export const SAFE = {
  top: 118,
  right: 64,
  bottom: 176,
  left: 64,
} as const;

export const STORY_ACCENTS: Record<string, string> = {
  legal_scandal: "#E84D5B",
  geopolitics_world: "#42A5F5",
  finance_markets: "#21C7A8",
  election_result: "#9C7CFF",
  natural_disaster: "#FF8B5A",
  tech_cyber: "#B5E853",
  culture_entertainment: "#FFB84D",
  general: "#F2F2F2",
};

export function getAccentColor(storyType: string): string {
  return STORY_ACCENTS[storyType] || STORY_ACCENTS.general;
}

// Mirror of src/shared/brand.js BRAND_VOICE. Authored together — keep in sync.
export const BRAND_VOICE = {
  tagline: "Know the story. Keep the receipts.",
  brandLabel: "Quydly",
} as const;
