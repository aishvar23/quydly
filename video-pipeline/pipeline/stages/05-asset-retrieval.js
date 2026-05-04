'use strict';

const path = require('path');
const { resolveAllAssets } = require('../../lib/asset-fetcher');

async function run(ctx) {
  const { script, outputDir } = ctx;
  const assetsDir = path.join(outputDir, 'assets');

  console.log(`[05-asset-retrieval] Resolving assets for ${script.scenes.length} scenes...`);

  const scenes = await resolveAllAssets(script.scenes, assetsDir);

  const summary = scenes.map(s =>
    `  Scene ${s.scene_id}: ${s.asset_type} (q=${s.asset_quality_score} r=${s.asset_relevance_score} safe=${s.asset_is_safe})`
  );
  console.log('[05-asset-retrieval] ✓ Asset resolution complete:\n' + summary.join('\n'));

  return {};
}

module.exports = { run };
