// Anthropic model selection for the pipeline — one place, so a cost or quality
// change is a single edit and an incident rollback is an app-setting flip
// rather than a redeploy.
//
// Two tiers, split by what the call actually does:
//
//   EDITORIAL  — writing and judgement a reader sees: the story narrative,
//                enrichment, social copy, cover hooks. Stays on Sonnet.
//
//   EXTRACTION — schema-constrained pulls and rubric scoring whose output is
//                validated locally before anything downstream trusts it:
//                fact/quote extraction (verbatim-checked by `verifyQuotes`)
//                and the quality audit (thresholded in storyAudit).
//                Haiku is ~3x cheaper on both directions and the local
//                validators — not the model tier — are the real quality gate.
//
// Both are env-overridable (ANTHROPIC_MODEL_EDITORIAL /
// ANTHROPIC_MODEL_EXTRACTION) so a quality regression can be reverted from the
// Function App settings without shipping code.
//
// Cost context (2026-08-11 spend investigation): sonnet-4-6 is $3/$15 per MTok,
// haiku-4-5 is $1/$5. A synthesis runs 5 calls; moving the three mechanical
// ones to the extraction tier is the largest per-story saving available that
// doesn't touch editorial voice.

export const MODEL_EDITORIAL =
  process.env.ANTHROPIC_MODEL_EDITORIAL || "claude-sonnet-4-6";

export const MODEL_EXTRACTION =
  process.env.ANTHROPIC_MODEL_EXTRACTION || "claude-haiku-4-5";
