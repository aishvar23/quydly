'use strict';

const fs = require('fs');
const path = require('path');

function generateMetadata(storyPackage, outputDir) {
  const metadata = {
    pipeline: 'animated-video-pipeline-v1',
    story_id: storyPackage.story.id,
    cluster_id: storyPackage.story.cluster_id,
    category_id: storyPackage.story.category_id,
    audience_geo: storyPackage.audienceGeo,
    story_type: storyPackage.script.story_type,
    video_candidate_score: storyPackage.audit.video_candidate_score,
    duration_sec: storyPackage.totalDurationSec,
    scene_count: storyPackage.scenes.length,
    asset_mix: summarizeAssets(storyPackage.scenes),
    title_variants: storyPackage.script.title_variants,
    thumbnail_copy: storyPackage.script.thumbnail_copy,
    publish_state: storyPackage.exportPath ? 'READY_TO_PUBLISH' : 'REVIEW_REQUIRED',
    render_path: storyPackage.renderVideoPath,
    export_path: storyPackage.exportPath,
    generated_at: new Date().toISOString(),
  };

  const metadataPath = path.join(outputDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  return {
    ...storyPackage,
    metadata,
    metadataPath,
  };
}

function summarizeAssets(scenes) {
  return scenes.reduce((summary, scene) => {
    const kind = scene.asset?.kind || 'unknown';
    summary[kind] = (summary[kind] || 0) + 1;
    return summary;
  }, {});
}

module.exports = {
  generateMetadata,
};
