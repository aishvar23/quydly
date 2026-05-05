'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { APP_ROOT, RENDER } = require('../../shared/config');

// Render the Thumbnail composition as a single 1280x720 PNG using
// `remotion still`. Same security pattern as render-video.js:
// invoke node directly on the Remotion CLI entry to avoid shell:true.
function renderThumbnail({ propsPath, outputPath }) {
  const remotionEntry = path.join(APP_ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  if (!fs.existsSync(remotionEntry)) {
    throw new Error(`Remotion CLI not found at ${remotionEntry}.`);
  }

  const args = [
    remotionEntry,
    'still',
    RENDER.entryPoint,
    'Thumbnail',
    outputPath,
    `--props=${propsPath}`,
    '--log=info',
  ];

  execFileSync(process.execPath, args, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    timeout: 180000,
  });

  return outputPath;
}

module.exports = { renderThumbnail };
