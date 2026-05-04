'use strict';

const fs = require('fs');
const path = require('path');
const { FIXTURES_ROOT } = require('../../shared/config');
const { normalizeStory, validateStory } = require('../../shared/story-normalizer');

function loadStory({ storyId, storyFile, mode = 'poc' }) {
  let raw;
  if (storyFile) {
    raw = readJson(resolvePath(storyFile));
  } else if (storyId !== undefined && storyId !== null) {
    const candidate = path.join(FIXTURES_ROOT, `sample-story-${storyId}.json`);
    raw = readJson(candidate);
  } else {
    throw new Error('loadStory requires storyId or storyFile');
  }

  const normalized = normalizeStory(raw);
  return validateStory(normalized, mode);
}

function readJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

module.exports = {
  loadStory,
};
