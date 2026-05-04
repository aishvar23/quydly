'use strict';

const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.resolve(
  APP_ROOT,
  process.env.VIDEO_PIPELINE_OUTPUT_ROOT || 'output'
);

const RENDER = {
  fps: 30,
  width: 1080,
  height: 1920,
  outroSeconds: 4,
  compositionId: 'ShortVideo',
  entryPoint: 'src/render/Root.tsx',
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name, fallback = null) {
  return process.env[name] || fallback;
}

module.exports = {
  APP_ROOT,
  OUTPUT_ROOT,
  RENDER,
  requireEnv,
  optionalEnv,
};
