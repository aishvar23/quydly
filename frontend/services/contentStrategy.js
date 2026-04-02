import { CATEGORIES, EDITORIAL_MIX } from "../../config/categories";
import FLAGS from "../../config/flags";

// ── EditorialStrategy — ACTIVE FOR PILOT ─────────────────────────────────────
const EditorialStrategy = {
  getLabel: () => "Today's Edition",
  getCategoryMix: () => EDITORIAL_MIX,
  isConfigurable: () => false,
  buildPromptCategories: () => {
    const cats = [];
    Object.entries(EDITORIAL_MIX).forEach(([id, count]) => {
      const cat = CATEGORIES.find((c) => c.id === id);
      for (let i = 0; i < count; i++) cats.push(cat);
    });
    return cats.sort(() => Math.random() - 0.5);
  },
};

// ── BeatStrategy — V2 STUB ────────────────────────────────────────────────────
const BeatStrategy = (beat) => ({
  getLabel: () => `Your ${beat.charAt(0).toUpperCase() + beat.slice(1)} Feed`,
  getCategoryMix: () => ({ [beat]: 3, world: 1, finance: 1 }),
  isConfigurable: () => false,
  buildPromptCategories: () => [],
});

// ── CustomStrategy — V2 PREMIUM STUB ─────────────────────────────────────────
const CustomStrategy = (weights) => ({
  getLabel: () => "Your Mix",
  getCategoryMix: () => weights,
  isConfigurable: () => true,
  buildPromptCategories: () => [],
});

// ── Factory — reads FLAGS.activeStrategy ─────────────────────────────────────
export function getActiveStrategy() {
  switch (FLAGS.activeStrategy) {
    case "beat":   return BeatStrategy("tech");
    case "custom": return CustomStrategy({ world: 1, tech: 2, finance: 1, culture: 1 });
    default:       return EditorialStrategy;
  }
}
