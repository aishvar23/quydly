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
    maxCandidatesPerDayPerGeo: 24, // hard ceiling on new candidates per geo per day
    // Per-run drip: the selector runs hourly, so capping how many candidates a
    // single run creates per geo spreads the daily quota across the day instead
    // of front-loading the whole allotment into the 00:00 UTC run (which made
    // every post fire in one midnight burst, then go silent for ~24h). With the
    // hourly cadence, 1/run ≈ 1 post/hour ≈ maxCandidatesPerDayPerGeo per day.
    maxCandidatesPerRunPerGeo: 1,

    // Service Bus queue the selector enqueues generation jobs to (D4)
    generateQueue: "social-post-generate-queue",

    // Auto-publish config. NOTE (owner decision 2026-05-31): the content gate is
    // BYPASSED — decideCandidateStatus auto-approves EVERY candidate when enabled.
    // The thresholds below are retained only for evaluateAutoApproval (kept in
    // social-safety.js for if/when the gate is restored); they are NOT enforced
    // on the live auto-publish path. `maxPerDay` IS still enforced as the per-day
    // ceiling (override in Azure with SOCIAL_MAX_AUTO_PER_DAY) — an anti-spam
    // ceiling to protect the X account, not a content filter.
    autoApprove: {
      minConfidence:   8,
      minStoryScore:  28,
      minUniqueDomains: 3,
      maxPerDay:       25, // anti-spam ceiling (was 3 when gated). Tune via SOCIAL_MAX_AUTO_PER_DAY.
      safeCategories: ["science", "technology", "culture", "finance"],
    },
  },
};

export default FLAGS;
