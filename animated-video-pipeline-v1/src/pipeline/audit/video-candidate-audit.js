'use strict';

const { completeJSON, hasAnthropic } = require('../../integrations/anthropic');

async function auditVideoCandidate(story, { useAI = false, mode = 'poc', skipAudit = false } = {}) {
  if (skipAudit) {
    return {
      video_candidate: true,
      video_candidate_score: 1,
      hook_sentence: story.headline,
      dominant_topic: story.category_id || 'general',
      visual_angle: 'audit skipped by operator',
      video_skip_reason: null,
      audit_source: 'skipped',
    };
  }

  const audit = useAI && hasAnthropic()
    ? await aiAudit(story)
    : heuristicAudit(story);

  const threshold = mode === 'production' ? 0.65 : 0.4;
  if (!audit.video_candidate || audit.video_candidate_score < threshold) {
    return {
      ...audit,
      rejected: true,
      video_skip_reason: audit.video_skip_reason ||
        `video_candidate_score ${audit.video_candidate_score.toFixed(2)} below ${threshold}`,
    };
  }

  return audit;
}

function heuristicAudit(story) {
  const text = [
    story.headline,
    story.summary,
    ...(story.key_points || []),
    ...(story.primary_geos || []),
  ].join(' ').toLowerCase();

  const visualSignals = [
    'map',
    'court',
    'charge',
    'market',
    'stock',
    'chart',
    'country',
    'minister',
    'government',
    'ai',
    'cyber',
    'bank',
    'tariff',
    'sanction',
  ];

  const riskyWeakSignals = ['minor victim', 'graphic', 'bodycam', 'mass casualty'];
  const hasVisualSignal = visualSignals.some((word) => text.includes(word)) ||
    (story.primary_geos || []).length > 0 ||
    story.source_count >= 3;
  const riskyWeak = riskyWeakSignals.some((word) => text.includes(word));

  const confidence = Math.min((story.confidence_score || 0) / 10, 1);
  const coherence = story.coherence_score ?? 0.7;
  const support = story.support_score ?? 0.7;
  const sourceScore = Math.min((story.source_count || 0) / 5, 1);
  const visualScore = hasVisualSignal ? 0.85 : 0.35;
  const penalty = riskyWeak ? 0.35 : 0;
  const score = clamp(
    confidence * 0.22 + coherence * 0.22 + support * 0.22 + sourceScore * 0.14 + visualScore * 0.2 - penalty
  );

  return {
    video_candidate: score >= 0.4 && !riskyWeak,
    video_candidate_score: Number(score.toFixed(2)),
    hook_sentence: buildHook(story),
    dominant_topic: story.category_id || 'general',
    visual_angle: hasVisualSignal ? 'contextual maps, data, institutions, or documents' : 'branded motion graphics',
    video_skip_reason: riskyWeak ? 'Story is too sensitive for automated V1 visualization' : null,
    audit_source: 'heuristic',
  };
}

async function aiAudit(story) {
  const system = [
    'You are a short-form news video editor.',
    'Audit whether a story can safely become a 30-60 second animated editorial explainer.',
    'Return strict JSON only.',
  ].join(' ');

  const prompt = `Story:\n${JSON.stringify(story, null, 2)}\n\nReturn this JSON shape:\n{
  "video_candidate": true,
  "video_candidate_score": 0.0,
  "hook_sentence": "",
  "dominant_topic": "",
  "visual_angle": "",
  "video_skip_reason": null
}`;

  return {
    ...(await completeJSON({ system, prompt, maxTokens: 700 })),
    audit_source: 'anthropic',
  };
}

function buildHook(story) {
  const headline = story.headline.replace(/\s+/g, ' ').trim();
  return headline.endsWith('.') ? headline : `${headline}.`;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  auditVideoCandidate,
  heuristicAudit,
};
