'use strict';

const path         = require('path');
const ffmpegPath   = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg       = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegPath);

async function run(ctx) {
  const { remotionVideoPath, storyId, outputDir } = ctx;
  const exportPath = path.join(outputDir, `story-${storyId}-final.mp4`);

  if (!remotionVideoPath) {
    throw new Error('[09-ffmpeg-export] No Remotion video path in context');
  }

  console.log('[09-ffmpeg-export] Re-encoding for platform delivery...');

  await encode(remotionVideoPath, exportPath);

  console.log(`[09-ffmpeg-export] ✓ Export → ${path.basename(exportPath)}`);
  return { exportPath };
}

function encode(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('192k')
      .outputOptions([
        '-crf 22',
        '-preset medium',
        '-profile:v high',
        '-level 4.0',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end',   resolve)
      .on('error', reject)
      .run();
  });
}

module.exports = { run };
