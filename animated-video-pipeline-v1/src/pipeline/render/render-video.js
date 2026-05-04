'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { APP_ROOT, RENDER } = require('../../shared/config');
const { getAccentColor } = require('../../shared/brand');

function prepareRenderProps(storyPackage, outputDir) {
  const jobKey = safeName(`story-${storyPackage.story.id}-${storyPackage.version || 'v1'}`);
  const publicDir = path.join(APP_ROOT, 'public', 'jobs', jobKey);
  fs.mkdirSync(publicDir, { recursive: true });

  const audioSrc = copyAudio(storyPackage.voice.audioPath, publicDir);
  const scenes = storyPackage.scenes.map((scene) => ({
    sceneId: scene.sceneId,
    role: scene.role,
    componentType: scene.componentType,
    sceneType: scene.sceneType,
    visualType: scene.visualType,
    purpose: scene.purpose,
    startSec: scene.startSec,
    durationSec: scene.durationSec,
    overlayText: scene.overlayText,
    narration: scene.narration,
    geoLocation: scene.geoLocation,
    asset: copyAsset(scene.asset, scene.sceneId, publicDir, jobKey),
  }));

  const props = {
    storyType: storyPackage.script.story_type,
    accentColor: getAccentColor(storyPackage.script.story_type),
    totalDurationSec: storyPackage.totalDurationSec,
    fps: RENDER.fps,
    audioSrc,
    brandName: 'QUYDLY',
    jobKey,
    scenes,
    subtitles: storyPackage.subtitles || [],
  };

  const propsPath = path.join(outputDir, 'render-props.json');
  const publicPropsPath = path.join(publicDir, 'props.json');
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), 'utf8');
  fs.writeFileSync(publicPropsPath, JSON.stringify(props, null, 2), 'utf8');

  return { props, propsPath, publicDir, jobKey };
}

function renderVideo(storyPackage, outputDir, { skipRender = false } = {}) {
  const render = prepareRenderProps(storyPackage, outputDir);
  if (skipRender) {
    return {
      ...storyPackage,
      render,
      renderVideoPath: null,
    };
  }

  const outputPath = path.join(outputDir, 'animated-render.mp4');
  const remotionBin = process.platform === 'win32'
    ? path.join(APP_ROOT, 'node_modules', '.bin', 'remotion.cmd')
    : path.join(APP_ROOT, 'node_modules', '.bin', 'remotion');

  if (!fs.existsSync(remotionBin)) {
    throw new Error('Remotion is not installed. Run npm install in animated-video-pipeline-v1.');
  }

  const args = [
    'render',
    RENDER.entryPoint,
    RENDER.compositionId,
    outputPath,
    `--props=${render.propsPath}`,
    '--concurrency=1',
    '--log=info',
  ];
  const command = [`"${remotionBin}"`, ...args.map((arg) => `"${arg}"`)].join(' ');

  execSync(command, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    timeout: 600000,
    shell: true,
  });

  return {
    ...storyPackage,
    render,
    renderVideoPath: outputPath,
  };
}

function copyAudio(audioPath, publicDir) {
  if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) return null;
  const dest = path.join(publicDir, 'narration.mp3');
  fs.copyFileSync(audioPath, dest);
  return path.posix.join('jobs', path.basename(publicDir), 'narration.mp3');
}

function copyAsset(asset, sceneId, publicDir, jobKey) {
  if (!asset || !asset.path || !fs.existsSync(asset.path)) {
    return { ...asset, src: null };
  }

  const ext = path.extname(asset.path) || '.asset';
  const filename = `scene-${sceneId}${ext}`;
  const dest = path.join(publicDir, filename);
  fs.copyFileSync(asset.path, dest);

  return {
    ...asset,
    src: path.posix.join('jobs', jobKey, filename),
  };
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-');
}

module.exports = {
  prepareRenderProps,
  renderVideo,
};
