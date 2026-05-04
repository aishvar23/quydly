'use strict';

const path = require('path');
const { renderVideo } = require('../../lib/ffmpeg-composer');

async function run(ctx) {
  const { script, storyId, audioPath, subtitlePath, isAudioStub, outputDir } = ctx;
  const videoPath     = path.join(outputDir, `story-${storyId}-video.mp4`);
  const thumbnailPath = path.join(outputDir, `story-${storyId}-thumbnail.png`);

  console.log('[07-timeline-composition] Rendering video...');
  console.log(`  Scenes: ${script.scenes.length}`);
  script.scenes.forEach(s => {
    console.log(`  Scene ${s.scene_id}: ${s.asset_type} ${s.duration_sec.toFixed(1)}s "${s.overlay_text?.slice(0, 40)}"`);
  });

  await renderVideo(
    script.scenes,
    audioPath,
    subtitlePath,
    videoPath,
    thumbnailPath,
    isAudioStub
  );

  console.log(`[07-timeline-composition] ✓ Video → ${path.basename(videoPath)}`);
  console.log(`[07-timeline-composition] ✓ Thumbnail → ${path.basename(thumbnailPath)}`);

  return { videoPath, thumbnailPath };
}

module.exports = { run };
