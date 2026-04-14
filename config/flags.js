const FLAGS = {
  activeStrategy:        "editorial", // "editorial" | "beat" | "custom"
  premiumEnabled:         false,       // flip to true in v2
  beatEnabled:            false,       // flip to true in v2
  customMixEnabled:       false,       // flip to true for Model C
  showStrategyHint:       true,        // show "My Beat coming in Premium" hint
  freeQuestionsPerDay:    5,
  premiumQuestionsPerDay: 10,

  // Gold Set pipeline — scoring thresholds.
  // Raise these as real cluster/story data is collected.
  scoring: {
    cluster: {
      eligible: 20, // cluster_score >= eligible → send to LLM
      optional: 12, // cluster_score >= optional → conditional send
      // < optional → discard
    },
    story: {
      publish: 60, // story_score >= publish → publish candidate
      review:  35, // story_score >= review  → flag for manual review
      // < review → reject
    },
  },
};
export default FLAGS;
