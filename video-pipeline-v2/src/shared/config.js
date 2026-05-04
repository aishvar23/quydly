'use strict';

const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.resolve(
  APP_ROOT,
  process.env.VIDEO_PIPELINE_OUTPUT_ROOT || 'output',
);
const FIXTURES_ROOT = path.resolve(APP_ROOT, 'fixtures');

const RENDER = {
  fps: 30,
  width: 1080,
  height: 1920,
  outroSeconds: 3.4,
  compositionId: 'EvidenceVideo',
  entryPoint: 'src/render/Root.tsx',
};

module.exports = {
  APP_ROOT,
  OUTPUT_ROOT,
  FIXTURES_ROOT,
  RENDER,
};
