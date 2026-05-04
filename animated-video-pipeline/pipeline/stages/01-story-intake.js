'use strict';

const axios = require('axios');

async function fetchStory(storyId) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('[story-intake] SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }

  const url  = `${SUPABASE_URL}/rest/v1/stories?id=eq.${storyId}&select=*`;
  const resp = await axios.get(url, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    timeout: 10000,
  });

  if (!resp.data || resp.data.length === 0) {
    throw new Error(`[story-intake] Story ${storyId} not found in Supabase`);
  }

  const row = resp.data[0];
  return {
    id:                row.id,
    cluster_id:        row.cluster_id,
    category_id:       row.category_id,
    headline:          row.headline,
    summary:           row.summary,
    key_points:        Array.isArray(row.key_points) ? row.key_points : [],
    confidence_score:  row.confidence_score,
    story_score:       parseFloat(row.story_score)       || 0,
    consistency_score: parseFloat(row.consistency_score) || 0,
    source_count:      row.source_count                  || 0,
    is_verified:       row.is_verified,
    specificity_score: row.specificity_score  != null ? parseFloat(row.specificity_score)  : null,
    coherence_score:   row.coherence_score    != null ? parseFloat(row.coherence_score)    : null,
    support_score:     row.support_score      != null ? parseFloat(row.support_score)      : null,
    quizability_score: row.quizability_score  != null ? parseFloat(row.quizability_score)  : null,
    primary_entities:  row.primary_entities   || [],
    primary_geos:      row.primary_geos       || [],
    published_at:      row.published_at,
  };
}

async function run(ctx) {
  const { storyId, mode } = ctx;
  console.log(`[01-story-intake] Loading story ${storyId} from Supabase (mode=${mode})`);

  const story = await fetchStory(storyId);

  const errors = [];
  if (!story.headline)                                                        errors.push('missing headline');
  if (!story.summary)                                                         errors.push('missing summary');
  if (!Array.isArray(story.key_points) || story.key_points.length < 3)       errors.push('fewer than 3 key_points');
  if (story.confidence_score < 6)                                             errors.push(`confidence_score ${story.confidence_score} < 6`);
  if (story.coherence_score  !== null && story.coherence_score  < 0.7)       errors.push(`coherence_score ${story.coherence_score} < 0.7`);
  if (story.support_score    !== null && story.support_score    < 0.7)       errors.push(`support_score ${story.support_score} < 0.7`);

  if (errors.length) throw new Error(`[story-intake] Validation failed: ${errors.join(', ')}`);

  if (!story.is_verified) {
    if (mode === 'production') {
      throw new Error('[story-intake] is_verified=false blocked in production mode');
    }
    console.warn('[story-intake] WARNING: story is_verified=false — POC/internal mode only');
  }

  console.log(`[01-story-intake] ✓ Story validated: "${story.headline}"`);
  return { story };
}

module.exports = { run };
