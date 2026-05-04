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
Evaluate this story for evidence-first animated video production.

Questions:
1. Does the story have named people, organizations, locations, numbers, or charges?
2. Is there a strong specific hook (a surprising fact, figure, or action)?
3. Can it be explained in 35–55 seconds without requiring real footage?
4. Is it one dominant story (not a diffuse multi-topic summary)?
5. Is it safe to visualize without misleading graphics?

Reject if: no specific hook, purely abstract, MIXED_STORY quality flag, no visualizable evidence elements.

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

  const minScore = mode === 'production' ? 0.65 : 0.4;

  if (!audit.video_candidate || score < minScore) {
    return {
      rejected: true,
      reason:   audit.video_skip_reason || `video_candidate_score ${score.toFixed(2)} below threshold ${minScore}`,
    };
  }

  console.log(`[02-video-audit] ✓ Approved — hook: "${audit.hook_sentence}"`);
  return {
    videoAudit:          audit,
    hookSentence:        audit.hook_sentence,
    videoCandidateScore: score,
  };
}

module.exports = { run };
