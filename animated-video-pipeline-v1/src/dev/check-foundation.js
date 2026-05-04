'use strict';

require('dotenv').config();

const os = require('os');
const fs = require('fs');
const path = require('path');
const { runPipeline } = require('../pipeline/orchestrator');
const { SCENE_TYPES } = require('../pipeline/scenes/scene-types');
const { STORY_TEMPLATES } = require('../pipeline/scenes/story-templates');

async function main() {
  assertSceneTemplates();

  const outputRoot = path.join(os.tmpdir(), 'quydly-animated-video-pipeline-v1-check');
  fs.rmSync(outputRoot, { recursive: true, force: true });

  const result = await runPipeline({
    storyFile: path.join(__dirname, '..', '..', 'fixtures', 'sample-story.json'),
    audienceGeo: 'global',
    mode: 'poc',
    dryRun: true,
    skipRender: true,
    outputRoot,
  });

  if (!['REVIEW_REQUIRED', 'READY_TO_PUBLISH'].includes(result.state)) {
    throw new Error(`Unexpected lint pipeline state: ${result.state}`);
  }
}

function assertSceneTemplates() {
  for (const [storyType, template] of Object.entries(STORY_TEMPLATES)) {
    if (template.scenes.length < 5) {
      throw new Error(`${storyType} template must have at least five scenes`);
    }
    for (const scene of template.scenes) {
      if (!SCENE_TYPES[scene.sceneType]) {
        throw new Error(`${storyType} uses unknown scene type ${scene.sceneType}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
