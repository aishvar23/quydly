// Per-story-type scene layout rules.
// Drives which components mount inside each scene and their entry delays.

export interface ComponentSpec {
  name: string;
  delayFrames: number;
}

export interface SceneLayout {
  components: ComponentSpec[];
}

export type LayoutMap = Record<string, Record<string, SceneLayout>>;

export const STORY_LAYOUTS: LayoutMap = {
  legal_scandal: {
    hook:          { components: [{ name: "HookStrap", delayFrames: 5 }, { name: "StatChip", delayFrames: 16 }] },
    headline:      { components: [{ name: "LowerThird", delayFrames: 4 }, { name: "StatChip", delayFrames: 14 }] },
    detail:        { components: [{ name: "ChargeCard", delayFrames: 4 }] },
    charges:       { components: [{ name: "ChargeCard", delayFrames: 4 }] },
    why_it_matters:{ components: [{ name: "ContextPanel", delayFrames: 5 }] },
    outro:         { components: [{ name: "OutroLockup", delayFrames: 0 }] },
  },

  geopolitics_conflict: {
    hook:          { components: [{ name: "HookStrap", delayFrames: 5 }] },
    headline:      { components: [{ name: "MapCallout", delayFrames: 6 }] },
    detail:        { components: [{ name: "LowerThird", delayFrames: 4 }] },
    geo:           { components: [{ name: "MapCallout", delayFrames: 6 }] },
    why_it_matters:{ components: [{ name: "ContextPanel", delayFrames: 5 }] },
    outro:         { components: [{ name: "OutroLockup", delayFrames: 0 }] },
  },

  finance_markets: {
    hook:          { components: [{ name: "HookStrap", delayFrames: 5 }, { name: "StatChip", delayFrames: 16 }] },
    headline:      { components: [{ name: "LowerThird", delayFrames: 4 }, { name: "StatChip", delayFrames: 14 }] },
    detail:        { components: [{ name: "LowerThird", delayFrames: 4 }] },
    geo:           { components: [{ name: "MapCallout", delayFrames: 6 }] },
    why_it_matters:{ components: [{ name: "ContextPanel", delayFrames: 5 }] },
    outro:         { components: [{ name: "OutroLockup", delayFrames: 0 }] },
  },

  corporate_leadership: {
    hook:          { components: [{ name: "HookStrap", delayFrames: 5 }, { name: "StatChip", delayFrames: 16 }] },
    headline:      { components: [{ name: "LowerThird", delayFrames: 4 }] },
    detail:        { components: [{ name: "LowerThird", delayFrames: 4 }] },
    geo:           { components: [{ name: "MapCallout", delayFrames: 6 }] },
    why_it_matters:{ components: [{ name: "ContextPanel", delayFrames: 5 }] },
    outro:         { components: [{ name: "OutroLockup", delayFrames: 0 }] },
  },

  tech_product: {
    hook:          { components: [{ name: "HookStrap", delayFrames: 5 }] },
    headline:      { components: [{ name: "LowerThird", delayFrames: 4 }, { name: "StatChip", delayFrames: 14 }] },
    detail:        { components: [{ name: "LowerThird", delayFrames: 4 }] },
    geo:           { components: [{ name: "MapCallout", delayFrames: 6 }] },
    why_it_matters:{ components: [{ name: "ContextPanel", delayFrames: 5 }] },
    outro:         { components: [{ name: "OutroLockup", delayFrames: 0 }] },
  },

  general: {
    hook:          { components: [{ name: "HookStrap", delayFrames: 5 }] },
    headline:      { components: [{ name: "LowerThird", delayFrames: 4 }] },
    detail:        { components: [{ name: "LowerThird", delayFrames: 4 }] },
    geo:           { components: [{ name: "MapCallout", delayFrames: 6 }] },
    why_it_matters:{ components: [{ name: "ContextPanel", delayFrames: 5 }] },
    outro:         { components: [{ name: "OutroLockup", delayFrames: 0 }] },
  },
};

export function getSceneLayout(storyType: string, sceneType: string): SceneLayout {
  const typeMap = STORY_LAYOUTS[storyType] ?? STORY_LAYOUTS.general;
  return typeMap[sceneType] ?? typeMap.detail ?? { components: [{ name: "LowerThird", delayFrames: 4 }] };
}

// Eyebrow labels derived from scene purpose
export const EYEBROW_LABELS: Record<string, string> = {
  establish_stakes:  "BREAKING",
  introduce_subject: "INVESTIGATION",
  provide_detail:    "DETAIL",
  list_charges:      "CHARGES FILED",
  explain_impact:    "WHY IT MATTERS",
  brand_close:       "",
};

export function getEyebrow(scenePurpose: string): string {
  return EYEBROW_LABELS[scenePurpose] ?? scenePurpose.toUpperCase().replace(/_/g, " ");
}

// Parse a numeric stat + label from overlay text.
// "$400K in bets" → { value: "$400K", label: "IN BETS" }
export function parseStatFromOverlay(overlayText: string): { value: string; label: string } | null {
  const match = overlayText.match(/(\$[\d.,]+[KkMmBb]?|[\d.,]+[KkMmBb]?%|\d{1,3}(?:,\d{3})+(?:\.\d+)?)/);
  if (!match) return null;
  const value = match[0].toUpperCase();
  const label = overlayText.replace(match[0], "").trim().toUpperCase().replace(/^[.,]/, "").trim();
  return { value, label: label || "" };
}
