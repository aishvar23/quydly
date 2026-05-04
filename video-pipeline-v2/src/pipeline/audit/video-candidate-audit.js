'use strict';

// Generic, type-agnostic audit. Decides whether a story should enter the
// editorial pipeline at all. Returns a score and, when below threshold,
// a rejected:true marker the orchestrator uses to bail.

function auditVideoCandidate(story, { mode = 'poc', skipAudit = false } = {}) {
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

  const audit = heuristicAudit(story);
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
    'map', 'court', 'charge', 'market', 'stock', 'chart', 'country',
    'minister', 'government', 'ai', 'cyber', 'bank', 'tariff', 'sanction',
  ];
  const riskyWeakSignals = ['minor victim', 'graphic', 'bodycam', 'mass casualty'];

  const hasVisualSignal = visualSignals.some((w) => text.includes(w)) ||
    (story.primary_geos || []).length > 0 ||
    (story.source_count || 0) >= 3;
  const riskyWeak = riskyWeakSignals.some((w) => text.includes(w));

  const confidence = Math.min((story.confidence_score || 0) / 10, 1);
  const coherence = story.coherence_score ?? 0.7;
  const support = story.support_score ?? 0.7;
  const sourceScore = Math.min((story.source_count || 0) / 5, 1);
  const visualScore = hasVisualSignal ? 0.85 : 0.35;
  const penalty = riskyWeak ? 0.35 : 0;

  const score = clamp(
    confidence * 0.22 +
    coherence * 0.22 +
    support * 0.22 +
    sourceScore * 0.14 +
    visualScore * 0.20 -
    penalty,
  );

  return {
    video_candidate: score >= 0.4 && !riskyWeak,
    video_candidate_score: Number(score.toFixed(2)),
    hook_sentence: buildHook(story),
    dominant_topic: story.category_id || 'general',
    visual_angle: hasVisualSignal
      ? 'contextual maps, data, institutions, or documents'
      : 'branded motion graphics',
    video_skip_reason: riskyWeak
      ? 'Story is too sensitive for automated V1 visualization'
      : null,
    audit_source: 'heuristic',
  };
}

function buildHook(story) {
  const headline = String(story.headline || '').replace(/\s+/g, ' ').trim();
  if (!headline) return '';
  return /[.!?]$/.test(headline) ? headline : `${headline}.`;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  auditVideoCandidate,
  heuristicAudit,
};
