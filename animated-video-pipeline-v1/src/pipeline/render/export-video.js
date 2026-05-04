'use strict';

const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegPath);

async function exportVideo(storyPackage, outputDir, { skipRender = false } = {}) {
  if (skipRender || !storyPackage.renderVideoPath) {
    return {
      ...storyPackage,
      exportPath: null,
    };
  }

  const exportPath = path.join(outputDir, 'final-vertical.mp4');
  await encode(storyPackage.renderVideoPath, exportPath);

  return {
    ...storyPackage,
    exportPath,
  };
}

function encode(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('192k')
      .outputOptions([
        '-crf 21',
        '-preset medium',
        '-profile:v high',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
      ])
      .output(output)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

module.exports = {
  exportVideo,
};
