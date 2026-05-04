'use strict';

const fs   = require('fs');
const path = require('path');

async function run(ctx) {
  const { story, script, modulePlan, storyId, audienceGeo, videoCandidateScore, storyType, outputDir } = ctx;

  const totalDuration = modulePlan.reduce((sum, m) => sum + m.durationSec, 0);
  const assetMix      = summariseAssets(modulePlan);

  const metadata = {
    story_id:              story.id,
    cluster_id:            story.cluster_id,
    category_id:           story.category_id,
    title_youtube:         truncate(story.headline, 100),
    title_x:               truncate(story.headline, 70),
    title_tiktok:          truncate(story.headline, 70),
    description:           `${story.summary.slice(0, 160)}…`,
    tags:                  extractTags(story),
    audience_geo:          audienceGeo,
    story_type:            storyType,
    duration_sec:          parseFloat(totalDuration.toFixed(1)),
    script_word_count:     script.full_script.trim().split(/\s+/).filter(Boolean).length,
    module_count:          modulePlan.length,
    module_types:          modulePlan.map(m => m.moduleType),
    asset_mix:             assetMix,
    video_candidate_score: videoCandidateScore ?? null,
    is_verified:           story.is_verified,
    pipeline:              'evidence-first-v1',
    generated_at:          new Date().toISOString(),
  };

  const metaPath = path.join(outputDir, `story-${storyId}-metadata.json`);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  console.log(`[13-metadata-generation] ✓ Metadata → ${path.basename(metaPath)}`);
  console.log(`  Duration: ${metadata.duration_sec}s | Modules: ${metadata.module_types.join(' → ')}`);
  return { metadataPath: metaPath };
}

function extractTags(story) {
  const base   = [story.category_id].filter(Boolean);
  const corpus = `${story.headline} ${story.summary}`;
  const patterns = [
    /\bVenezuela\b/i, /\bChina\b/i, /\bRussia\b/i, /\bUkraine\b/i,
    /\bmilitary\b/i,  /\bclassified\b/i, /\bwire fraud\b/i, /\bsanctions\b/i,
    /\bAI\b/,         /\btariff\b/i,     /\bindicted\b/i,   /\bfraud\b/i,
  ];
  for (const p of patterns) {
    const m = corpus.match(p);
    if (m) base.push(m[0]);
  }
  return [...new Set(base)].slice(0, 8);
}

function summariseAssets(modulePlan) {
  const counts = {};
  for (const m of modulePlan) {
    const t = m.assetType || 'motion_graphic';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

module.exports = { run };
