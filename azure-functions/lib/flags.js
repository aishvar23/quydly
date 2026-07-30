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

  // Synthesis quality gates (story-synthesizer Phase B). Per-category, mirroring
  // the { default, ai } shape used by clustering.minSharedEntities. The default
  // bar is unchanged from the original hard-coded constants; only `ai` is relaxed.
  //
  // Why `ai` is relaxed: PR #132 deliberately lets thinner AI clusters
  // (2 articles / 2 domains, entity-poor) through clustering so genuinely-related
  // AI coverage merges instead of dying as singletons. Those clusters give the
  // LLM less corroborated material, so they disproportionately trip the three
  // terminal synthesis gates (confidence / key_points / story_score=reject) and
  // get marked PROCESSED with no story row. Of 9 eligible AI clusters post-#132,
  // only 2 produced a story (yield 48%→22%). A lower-but-sane AI bar lets the
  // substantive ones (e.g. 4–6 article / 4–5 domain clusters scoring 33–41) write
  // a story. The 2-domain corroboration floor (synthesis.minUniqueDomains.ai = 2)
  // is asserted explicitly in the synthesizer so the relaxed bar can never admit a
  // single-domain singleton even if a future clustering change leaks one through.
  synthesis: {
    // narrative.confidence_score floor. Lowered to 5 for `ai`. Thin AI clusters
    // (2 articles / 2 domains, entity-poor) give the synthesis LLM little
    // corroboration, so it honestly returns confidence 5 even for substantive,
    // multi-domain coverage — and the default-6 floor rejected ~80% of eligible AI
    // clusters (only 2 of 10 wrote a story post-#132). The downstream coupling is
    // handled in tandem: backend fetchStoryPool (the global quiz path) was made
    // per-category to require confidence_score >= 5 for `ai` (>= 6 elsewhere), so a
    // confidence-5 AI story is now quiz-reachable rather than a dead row. The two
    // floors MUST move together — see backend/services/articleStore.js fetchStoryPool.
    confidence:        { default: 6, ai: 5 },
    // key_points completeness. AI write-ups frequently land 2 solid points off a
    // 2-source cluster; demanding 3 discards otherwise-usable stories. The audit
    // (storyAudit.js) still independently rejects hollow/circular key_points for
    // quiz candidacy, so this is a creation gate, not a quality bypass.
    keyPoints:         { default: 3, ai: 2 },
    // story_score below this → disposition "reject" → no story row. Default mirrors
    // scoring.story.review (35). Lowered to 28 for `ai`: a 2-article/2-domain AI
    // cluster at confidence 6 / consistency ~0.36 lands ~32–36, straddling 35, so
    // the default review bar drops coherent AI stories on noise. 28 still rejects
    // genuinely incoherent low-consistency output (the 2 AI stories that DID write
    // post-#132 scored 48 and 51, far above either bar).
    storyReview:       { default: 35, ai: 28 },
    // Corroboration floor for the relaxed `ai` path: never synthesize a cluster
    // with fewer than this many distinct domains. Clustering's own quality gate
    // already enforces >=2 domains; asserting it here makes the synthesis side
    // defensive so a future clustering relaxation can't leak a single-source
    // singleton through the lowered AI gates.
    minUniqueDomains:  { default: 1, ai: 2 },
  },

  // Clustering thresholds (article-clusterer). Scoring/eligibility knobs only.
  clustering: {
    // Entities an article must share with an existing cluster to MERGE into it.
    // AI headlines are entity-poor and repetitive ("OpenAI", "AI", "model"), so
    // genuinely-related AI coverage fails the default-3 gate, forms singletons,
    // and dies at the >=2-domain quality gate. A lower bar for `ai` lets that
    // coverage merge into one cluster that then accumulates >=2 domains. Other
    // verticals keep the stricter default to avoid false-positive merges.
    // hasSpecificHighSignalEntity still applies, so a bare region overlap alone
    // never anchors a merge regardless of this count.
    minSharedEntities: { default: 3, ai: 2 },

    // Per-category ceiling on synthesize-queue enqueues per UTC day
    // (distinct clusters, counted via clusters.synthesis_queued_at). Categories
    // not listed are unlimited; empty map = no caps (and the clusterer runs
    // zero extra queries). Enforced in article-clusterer's enqueue gate: a
    // capped cluster stays PENDING (no synthesis_queued_at write) and may
    // enqueue on a later day while still inside the 36h River window.
    // Generic mechanism, kept for future per-category throttling (e.g.
    // { sports: 2 }). Culture no longer needs a cap — its feeds were removed
    // outright from rss-feeds.js (owner decision 2026-07-30).
    maxSynthesisEnqueuesPerDay: {},
  },

  // Social distribution pipeline thresholds (Phase 1+).
  // Scoring/eligibility knobs only — keep frontend flags in config/flags.js.
  social: {
    // Candidate eligibility (§7.1 "Initial MVP Thresholds")
    minStoryScore:   25, // story_score      >= this to be eligible
    minConfidence:    7, // confidence_score >= this (stories store 1–10 int)
    minRelevance:    20, // story_audiences.relevance_score >= this
    freshnessHours:  36, // story published within this window
    // Categories the EXISTING handles (@quydly / @quydlyenglish) must NOT post.
    // `ai` was excluded here while the AI vertical waited for dedicated handles,
    // but the owner's category-mix target (2026-07-23: AI/Tech ≈40% of published
    // posts) is unreachable without it — `tech` alone yields ~1 eligible story
    // per fortnight. Re-add "ai" here if/when dedicated AI handles ship.
    excludeCategories: [],
    maxCandidatesPerDayPerGeo: 24, // hard ceiling on new candidates per geo per day
    // Per-run drip: the selector runs hourly, so capping how many candidates a
    // single run creates per geo spreads the daily quota across the day instead
    // of front-loading the whole allotment into the 00:00 UTC run (which made
    // every post fire in one midnight burst, then go silent for ~24h). With the
    // hourly cadence, 1/run ≈ 1 post/hour ≈ maxCandidatesPerDayPerGeo per day.
    maxCandidatesPerRunPerGeo: 1,

    // Category-mix weighting for candidate selection (owner request 2026-07-23:
    // published posts skewed heavily world/culture; target AI&Tech 40%, World
    // 40%, Sports 10%, everything else 10%). Selection uses a deterministic
    // weighted round-robin (D'Hondt quotients) per geo, seeded with the groups
    // of candidates already created today, so the hourly 1-per-run drip
    // converges on these proportions across the day. A group with no eligible
    // stories simply cedes its slots to the others in proportion — supply never
    // stalls because a bucket is empty. NOTE: candidates are shared by ALL
    // platforms (X/IG/FB), so this mix applies pipeline-wide, not just IG.
    //   groups     — name → { categories: [story.category_id...], weight }
    //   defaultGroup — bucket for any category not listed in a group
    // `sports` has no story category yet; it activates automatically if one is
    // added, and until then its 10% redistributes to the other groups.
    categoryWeights: {
      enabled: true,
      defaultGroup: "others",
      groups: {
        aiTech: { categories: ["ai", "tech"], weight: 40 },
        world:  { categories: ["world"],      weight: 40 },
        sports: { categories: ["sports"],     weight: 10 },
        others: { categories: [],             weight: 10 }, // culture, finance, science, …
      },
    },

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
      // "culture" pruned 2026-07-30 — the vertical is retired (no feeds ingested).
      safeCategories: ["science", "technology", "finance"],
    },
  },
};

export default FLAGS;
