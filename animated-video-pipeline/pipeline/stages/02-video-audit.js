'use strict';

const claude = require('../../lib/claude-client');

const SYSTEM_PROMPT = `You are a video editorial auditor for a short-form news explainer channel.
Evaluate whether a story is suitable for a 30–60 second animated explainer video.
Output strict JSON only — no markdown fences, no extra text.`;

function buildAuditPrompt(story) {
  return `STORY:
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${story.key_points.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}
Confidence: ${story.confidence_score}
Published: ${story.published_at || 'unknown'}

AUDIT TASK:
Answer each question and produce a final verdict.

Questions:
1. Is this story visually explainable? (maps, charts, legal, market, or institutional visuals)
2. Is it strong enough for a 30–60 second short? (one dominant angle, clear hook)
3. Does it have one dominant topic? (not a mixed multi-story summary)
4. Is there a clear hook sentence? (something that makes viewers stop scrolling)
5. Is it safe to visualize? (no highly sensitive content requiring real footage of victims or minors)

Reject if: purely quote-trivia, weak or vague, highly context-dependent with no visual angle, or mixed/diffuse topics.

OUTPUT FORMAT:
{
  "video_candidate": true | false,
  "video_candidate_score": 0.0–1.0,
  "hook_sentence": "...",
  "dominant_topic": "...",
  "visual_angle": "...",
  "video_skip_reason": "..." | null
}`;
}

async function run(ctx) {
  const { story, skipAudit, mode } = ctx;

  if (skipAudit) {
    console.log('[02-video-audit] Skipping audit (--skip-audit flag set)');
    return {};
  }

  console.log('[02-video-audit] Auditing video candidacy...');

  const audit = await claude.completeJSON({
    systemPrompt: SYSTEM_PROMPT,
    prompt:       buildAuditPrompt(story),
    maxTokens:    512,
  });

  const score = typeof audit.video_candidate_score === 'number' ? audit.video_candidate_score : 0;
  console.log(`[02-video-audit] Score: ${score.toFixed(2)} | Candidate: ${audit.video_candidate}`);

  // In production mode, enforce minimum score
  const minScore = mode === 'production' ? 0.65 : 0.4;

  if (!audit.video_candidate || score < minScore) {
    return {
      rejected: true,
      reason:   audit.video_skip_reason || `video_candidate_score ${score.toFixed(2)} below threshold ${minScore}`,
    };
  }

  console.log(`[02-video-audit] ✓ Approved — hook: "${audit.hook_sentence}"`);
  return {
    videoAudit:        audit,
    hookSentence:      audit.hook_sentence,
    videoCandidateScore: score,
  };
}

module.exports = { run };
