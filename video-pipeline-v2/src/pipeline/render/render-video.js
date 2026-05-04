'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { APP_ROOT, RENDER } = require('../../shared/config');
const { prepareRenderProps } = require('./prepare-render-props');

function renderVideo(storyPackage, outputDir, { skipRender = false } = {}) {
  const render = prepareRenderProps(storyPackage, outputDir);
  if (skipRender) {
    return { ...storyPackage, render, renderVideoPath: null };
  }

  const outputPath = path.join(outputDir, 'animated-render.mp4');
  // Invoke the Remotion CLI's JS entry directly via `node`. Avoids the
  // Windows `.cmd` shim, which would force shell:true and reintroduce a
  // command-injection surface.
  const remotionEntry = path.join(APP_ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

  if (!fs.existsSync(remotionEntry)) {
    throw new Error(`Remotion CLI not found at ${remotionEntry}. Run npm install in video-pipeline-v2.`);
  }

  const args = [
    remotionEntry,
    'render',
    RENDER.entryPoint,
    RENDER.compositionId,
    outputPath,
    `--props=${render.propsPath}`,
    '--concurrency=1',
    '--log=info',
  ];

  // execFileSync with process.execPath (= the running node binary). No shell,
  // no metacharacter interpretation. Args are passed verbatim.
  execFileSync(process.execPath, args, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    timeout: 600000,
  });

  return {
    ...storyPackage,
    render,
    renderVideoPath: outputPath,
  };
}

module.exports = { renderVideo };
