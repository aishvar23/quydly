'use strict';

const path = require('path');
const fs   = require('fs');
const { resolveAllAssets } = require('../../lib/stock-client');
const { assignComponentTypes } = require('../../lib/scene-component-mapper');

async function run(ctx) {
  const { script, story, outputDir } = ctx;
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  console.log(`[06-asset-resolution] Resolving assets for ${script.scenes.length} scenes...`);

  const storyEntities = story?.primary_entities || [];
  const scenes = await resolveAllAssets(script.scenes, assetsDir, storyEntities);

  // Assign Remotion component types based on visual concept + scene position
  assignComponentTypes(scenes, script.story_type);

  const summary = scenes.map(s =>
    `  Scene ${s.scene_id}: [${s.component_type}] ${s.asset_type} q=${s.asset_quality_score} safe=${s.asset_is_safe}`
  );
  console.log('[06-asset-resolution] ✓ Asset resolution complete:\n' + summary.join('\n'));

  return {};
}

module.exports = { run };
