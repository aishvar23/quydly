'use strict';

const fs = require('fs');
const path = require('path');
const { selectRows, hasSupabase } = require('../../integrations/supabase-rest');
const { normalizeStory, validateStory } = require('../../shared/story-normalizer');

const STORY_SELECT = [
  'id',
  'cluster_id',
  'category_id',
  'headline',
  'summary',
  'key_points',
  'confidence_score',
  'coherence_score',
  'support_score',
  'story_score',
  'source_count',
  'is_verified',
  'primary_entities',
  'primary_geos',
  'published_at',
].join(',');

async function loadStory({ storyId, storyFile, mode }) {
  const raw = storyFile
    ? readStoryFile(storyFile)
    : await fetchStoryById(storyId);

  const story = normalizeStory(raw);
  validateStory(story, mode);
  return story;
}

async function selectVideoCandidates({ limit = 5, productionOnly = true } = {}) {
  if (!hasSupabase()) {
    throw new Error('Supabase credentials are required for candidate selection');
  }

  const verified = productionOnly ? '&is_verified=eq.true' : '';
  const query = [
    `select=${encodeURIComponent(STORY_SELECT)}`,
    verified.replace(/^&/, ''),
    'order=story_score.desc.nullslast',
    `limit=${limit}`,
  ].filter(Boolean).join('&');

  const rows = await selectRows('stories', query);
  return rows.map(normalizeStory);
}

async function fetchStoryById(storyId) {
  if (!storyId) throw new Error('Either --story-id or --story-file is required');
  if (!hasSupabase()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required when using --story-id');
  }

  const query = [
    `select=${encodeURIComponent(STORY_SELECT)}`,
    `id=eq.${encodeURIComponent(storyId)}`,
    'limit=1',
  ].join('&');

  const rows = await selectRows('stories', query);
  if (!rows.length) throw new Error(`Story ${storyId} not found`);
  return rows[0];
}

function readStoryFile(storyFile) {
  const fullPath = path.resolve(process.cwd(), storyFile);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

module.exports = {
  loadStory,
  selectVideoCandidates,
};
