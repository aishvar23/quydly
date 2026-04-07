import FLAGS from "../../config/flags";

// ── EditorialStrategy — ACTIVE FOR PILOT ─────────────────────────────────────
// Category mix is determined dynamically by backend scoring — no fixed quotas.
const EditorialStrategy = {
  getLabel: () => "Today's Edition",
  getCategoryMix: () => ({}),
  isConfigurable: () => false,
  buildPromptCategories: () => [],
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
