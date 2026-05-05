'use strict';

function normalizeStory(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Story payload must be an object');
  }

  return {
    id: raw.id,
    cluster_id: raw.cluster_id || null,
    category_id: raw.category_id || raw.category || 'general',
    headline: String(raw.headline || raw.title || '').trim(),
    summary: String(raw.summary || raw.description || '').trim(),
    key_points: Array.isArray(raw.key_points) ? raw.key_points.filter(Boolean) : [],
    confidence_score: numberOr(raw.confidence_score, 0),
    coherence_score: nullableNumber(raw.coherence_score),
    consistency_score: nullableNumber(raw.consistency_score),
    support_score: nullableNumber(raw.support_score),
    story_score: numberOr(raw.story_score, 0),
    source_count: numberOr(raw.source_count, 0),
    is_verified: Boolean(raw.is_verified),
    primary_entities: Array.isArray(raw.primary_entities) ? raw.primary_entities : [],
    primary_geos: Array.isArray(raw.primary_geos) ? raw.primary_geos : [],
    // Bridge phase 1 — pass through primary_places (the rich
    // {code, name} shape) AND the synth-side editorial fields that
    // the normalizer was previously dropping. deriveAngle + the
    // publishability gate read these.
    primary_places: Array.isArray(raw.primary_places) ? raw.primary_places : [],
    hook_sentence: typeof raw.hook_sentence === 'string' ? raw.hook_sentence : null,
    why_it_matters: typeof raw.why_it_matters === 'string' ? raw.why_it_matters : null,
    editorial_posture: typeof raw.editorial_posture === 'string' ? raw.editorial_posture : null,
    story_type: typeof raw.story_type === 'string' ? raw.story_type : null,
    primary_entities_enriched: Array.isArray(raw.primary_entities_enriched)
      ? raw.primary_entities_enriched
      : [],
    structured_numbers: raw.structured_numbers && typeof raw.structured_numbers === 'object'
      ? raw.structured_numbers
      : null,
    timeline_events: Array.isArray(raw.timeline_events) ? raw.timeline_events : [],
    timeline_disposition: typeof raw.timeline_disposition === 'string'
      ? raw.timeline_disposition
      : null,
    verification_status: typeof raw.verification_status === 'string' ? raw.verification_status : null,
    factual_conflicts: Array.isArray(raw.factual_conflicts) ? raw.factual_conflicts : [],
    published_at: raw.published_at || null,
    source_documents: Array.isArray(raw.source_documents) ? raw.source_documents : [],
  };
}

function validateStory(story, mode = 'poc') {
  const errors = [];
  if (!story.id) errors.push('missing id');
  if (!story.headline) errors.push('missing headline');
  if (!story.summary) errors.push('missing summary');
  if (story.key_points.length < 2) errors.push('fewer than 2 key_points');
  if (story.confidence_score && story.confidence_score < 5) {
    errors.push(`confidence_score ${story.confidence_score} < 5`);
  }
  if (story.coherence_score !== null && story.coherence_score < 0.65) {
    errors.push(`coherence_score ${story.coherence_score} < 0.65`);
  }
  if (story.support_score !== null && story.support_score < 0.65) {
    errors.push(`support_score ${story.support_score} < 0.65`);
  }
  if (mode === 'production' && !story.is_verified) {
    errors.push('is_verified=false blocked in production');
  }

  if (errors.length > 0) {
    throw new Error(`Story validation failed: ${errors.join(', ')}`);
  }

  return story;
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  normalizeStory,
  validateStory,
};
