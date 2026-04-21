// Story quality audit — scores stories for quiz-generation suitability.
// Called by story-synthesizer after each story write; also used by backfillAudit.js.
//
// auditStory(story, facts) → audit result object (no DB writes)
// persistAudit(supabase, story_id, auditResult, now) → writes to stories + story_quality_audits

import Anthropic from "@anthropic-ai/sdk";

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const MODEL = "claude-sonnet-4-20250514";

const THRESHOLDS = {
  specificity_score: 0.6,
  coherence_score:   0.7,
  support_score:     0.7,
  quizability_score: 0.7,
};

const BLOCKING_FLAGS = ["HOLLOW_STORY", "MIXED_STORY", "UNSUPPORTED_FACTS"];

/**
 * Score a story for quiz-generation suitability.
 * @param {{ headline, summary, key_points, confidence_score, source_count }} story
 * @param {Array<{ fact, type, source_count }>} facts  — pass1 extracted facts (optional)
 * @returns {Promise<{ specificity_score, coherence_score, support_score, quizability_score,
 *                     quality_flags, quiz_candidate, decision, reason }>}
 */
export async function auditStory(story, facts = []) {
  const ai = getAnthropic();

  const factsSection = facts.length > 0
    ? `\nExtracted facts (cross-source support):\n${facts
        .map(f => `- [${f.type}, sources: ${f.source_count}] ${f.fact}`)
        .join("\n")}`
    : "";

  const prompt = `You are a story quality auditor for a daily news quiz. Score this story for quiz-generation suitability.

Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${story.key_points.map((kp, i) => `${i + 1}. ${kp}`).join("\n")}
Confidence: ${story.confidence_score}/10
Sources: ${story.source_count}${factsSection}

Score each dimension 0.0–1.0:

specificity_score — Do key_points contain concrete facts beyond restating the headline?
- LOW if key_points just paraphrase the headline/summary with no new entities, actions, or outcomes.
- LOW if phrases like "experts are analyzing implications" appear without concrete follow-through.

coherence_score — Is the story about ONE dominant event/topic?
- LOW if multiple unrelated companies, products, or events appear in key_points.
- LOW if different key_points point to different sub-stories.

support_score — Are claims grounded in the extracted facts?
- LOW if key_points introduce entities or events absent from the extracted facts.
- LOW if speculative glue text is presented as established fact.
- HIGH if most key_points map directly to extracted facts with source_count >= 2.

quizability_score — Is there one clear central fact worth testing?
- LOW if the only testable fact is an exact quote or adjective phrasing.
- LOW if the only testable fact is a non-central percentage, forecast, or date.
- LOW if HOLLOW_STORY, MIXED_STORY, or UNSUPPORTED_FACTS apply.

quality_flags — include ALL that apply (empty array if none):
HOLLOW_STORY: key_points add no new information beyond the headline
CIRCULAR_KEY_POINTS: key_points restate the same fact in slightly different words
MIXED_STORY: story covers multiple unrelated events or subjects
LOW_SPECIFICITY: lacks concrete named entities, actions, or outcomes
LOW_SUPPORT: key_points contain claims not present in extracted facts
UNSUPPORTED_FACTS: a major event or entity appears only in synthesised output, not source facts
QUOTE_TRIVIA_RISK: strongest testable fact is an exact quote or adjective wording
NUMERIC_TRIVIA_RISK: strongest testable fact is a non-central number or forecast

Respond ONLY with valid JSON, no markdown:
{
  "specificity_score": 0.0,
  "coherence_score": 0.0,
  "support_score": 0.0,
  "quizability_score": 0.0,
  "quality_flags": [],
  "reason": "one sentence"
}`;

  const msg = await ai.messages.create({
    model:      MODEL,
    max_tokens: 512,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let scores;
  try {
    scores = JSON.parse(raw);
  } catch {
    throw new Error(`[storyAudit] invalid JSON: ${raw.slice(0, 200)}`);
  }

  const flags       = Array.isArray(scores.quality_flags) ? scores.quality_flags : [];
  const hasBlocker  = flags.some(f => BLOCKING_FLAGS.includes(f));
  const meetsScores = (
    (scores.specificity_score ?? 0) >= THRESHOLDS.specificity_score &&
    (scores.coherence_score   ?? 0) >= THRESHOLDS.coherence_score   &&
    (scores.support_score     ?? 0) >= THRESHOLDS.support_score     &&
    (scores.quizability_score ?? 0) >= THRESHOLDS.quizability_score
  );

  const quiz_candidate = !hasBlocker && meetsScores;

  return {
    specificity_score: scores.specificity_score ?? 0,
    coherence_score:   scores.coherence_score   ?? 0,
    support_score:     scores.support_score     ?? 0,
    quizability_score: scores.quizability_score ?? 0,
    quality_flags:     flags,
    quiz_candidate,
    decision: quiz_candidate ? "approved" : "rejected",
    reason:   scores.reason ?? "",
  };
}

/**
 * Write audit result to stories + story_quality_audits.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} story_id
 * @param {ReturnType<Awaited<typeof auditStory>>} auditResult
 * @param {string} [now]  — ISO timestamp; defaults to now
 */
export async function persistAudit(supabase, story_id, auditResult, now) {
  const ts = now ?? new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("stories")
    .update({
      specificity_score: auditResult.specificity_score,
      coherence_score:   auditResult.coherence_score,
      support_score:     auditResult.support_score,
      quizability_score: auditResult.quizability_score,
      quality_flags:     auditResult.quality_flags,
      quiz_candidate:    auditResult.quiz_candidate,
      audited_at:        ts,
    })
    .eq("id", story_id);

  if (updateErr) throw new Error(`[storyAudit] stories update: ${updateErr.message}`);

  const { error: auditErr } = await supabase
    .from("story_quality_audits")
    .insert({
      story_id,
      specificity_score: auditResult.specificity_score,
      coherence_score:   auditResult.coherence_score,
      support_score:     auditResult.support_score,
      quizability_score: auditResult.quizability_score,
      quality_flags:     auditResult.quality_flags,
      decision:          auditResult.decision,
      reason:            auditResult.reason,
    });

  if (auditErr) throw new Error(`[storyAudit] audit log insert: ${auditErr.message}`);
}
