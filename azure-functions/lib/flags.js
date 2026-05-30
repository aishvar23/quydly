const FLAGS = {
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

  // Social distribution pipeline thresholds (Phase 1+).
  // Scoring/eligibility knobs only — keep frontend flags in config/flags.js.
  social: {
    // Candidate eligibility (§7.1 "Initial MVP Thresholds")
    minStoryScore:   25, // story_score      >= this to be eligible
    minConfidence:    7, // confidence_score >= this (stories store 1–10 int)
    minRelevance:    20, // story_audiences.relevance_score >= this
    freshnessHours:  36, // story published within this window
    maxCandidatesPerDayPerGeo: 10, // hard cap on new candidates per geo per day

    // Service Bus queue the selector enqueues generation jobs to (D4)
    generateQueue: "social-post-generate-queue",

    // Phase 5 auto-approval gate (§10.3) — OFF by default, enforced elsewhere.
    autoApprove: {
      minConfidence:   8,
      minStoryScore:  30,
      minUniqueDomains: 3,
      maxPerDay:        3,
      safeCategories: ["science", "tech", "culture", "finance"],
    },
  },
};

export default FLAGS;
