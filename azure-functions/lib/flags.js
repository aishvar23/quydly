// Copy of config/flags.js — kept in sync manually.
// If config/flags.js changes, update this file too (see CLAUDE.md).

const FLAGS = {
  activeStrategy:        "editorial",
  premiumEnabled:         false,
  beatEnabled:            false,
  customMixEnabled:       false,
  showStrategyHint:       true,
  freeQuestionsPerDay:    5,
  premiumQuestionsPerDay: 10,

  scoring: {
    cluster: {
      eligible: 20,
      optional: 12,
    },
    story: {
      publish: 60,
      review:  35,
    },
  },
};
export default FLAGS;
