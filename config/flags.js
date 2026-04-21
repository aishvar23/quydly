const FLAGS = {
  activeStrategy:        "editorial", // "editorial" | "beat" | "custom"
  premiumEnabled:         false,       // flip to true in v2
  beatEnabled:            false,       // flip to true in v2
  customMixEnabled:       false,       // flip to true for Model C
  showStrategyHint:       true,        // show "My Beat coming in Premium" hint
  freeQuestionsPerDay:    5,
  premiumQuestionsPerDay: 10,
  audienceFeedMix: {
    enabled:                true,
    india: {
      heroBuckets:          0.60, // hero/standard rank_bucket + 'in' in primary_geos
      globalSigIndia:       0.25, // high global_significance_score + 'in' in primary_geos
      globalOnly:           0.15, // top global_significance_score, not already picked
      globalSigThreshold:   60,   // stories.global_significance_score >= this for pools B & C
    },
    minRowsForAudienceFeed: 10,   // fall back to raw articles if fewer rows than this
  },
};

export default FLAGS;
