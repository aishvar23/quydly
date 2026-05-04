'use strict';

const fs   = require('fs');
const path = require('path');

async function run(ctx) {
  const { story, script, storyId, audienceGeo, outputDir } = ctx;

  const metadata = {
    story_id:        story.id,
    cluster_id:      story.cluster_id,
    category_id:     story.category_id,
    title_youtube:   truncate(story.headline, 100),
    title_x:         truncate(story.headline, 70),
    title_tiktok:    truncate(story.headline, 70),
    description:     `A Quydly short news explainer: ${story.summary.slice(0, 160)}...`,
    tags:            extractTags(story),
    audience_geo:    audienceGeo,
    duration_sec:    script.scenes.reduce((s, sc) => s + sc.duration_sec, 0).toFixed(1),
    script_word_count: script.full_script.trim().split(/\s+/).length,
    scene_count:     script.scenes.length,
    asset_mix:       summariseAssets(script.scenes),
    is_verified:     story.is_verified,
    mode:            'poc_internal_only',
    generated_at:    new Date().toISOString(),
  };

  const metaPath = path.join(outputDir, `story-${storyId}-metadata.json`);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  console.log(`[08-metadata-generation] ✓ Metadata → ${path.basename(metaPath)}`);
  return { metadataPath: metaPath };
}

function extractTags(story) {
  const tags = [story.category_id];
  const words = `${story.headline} ${story.summary}`;
  const patterns = [
    /\bVenezuela\b/i, /\bMaduro\b/i, /\bPolymarket\b/i,
    /\bspecial forces\b/i, /\bmilitary\b/i, /\bclassified\b/i,
    /\bwire fraud\b/i, /\bnational security\b/i,
  ];
  for (const p of patterns) {
    const m = words.match(p);
    if (m) tags.push(m[0]);
  }
  return [...new Set(tags)].slice(0, 8);
}

function summariseAssets(scenes) {
  const counts = {};
  for (const s of scenes) {
    counts[s.asset_type] = (counts[s.asset_type] || 0) + 1;
  }
  return counts;
}

function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

module.exports = { run };
