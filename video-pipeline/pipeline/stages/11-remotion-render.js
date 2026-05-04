'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const { getAccentColor } = require('../../lib/brand-config');

const FPS          = 30;
const REMOTION_DIR = path.resolve(__dirname, '../../remotion');

async function run(ctx) {
  const { modulePlan, storyId, audioPath, subtitleCues, totalDuration, storyType, outputDir, version } = ctx;

  console.log('[11-remotion-render] Preparing Remotion render...');
  ensureRemotionInstalled();

  const jobKey    = `story-${storyId}-${version}`;
  const publicDir = path.join(REMOTION_DIR, 'public', 'assets', jobKey);
  fs.mkdirSync(publicDir, { recursive: true });

  // Copy audio into Remotion public dir
  const audioDest = path.join(publicDir, 'narration.mp3');
  if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) {
    fs.copyFileSync(audioPath, audioDest);
  }

  // Copy map assets and build module props for Remotion
  const modules = prepareModuleProps(modulePlan, publicDir, jobKey);

  const videoProps = {
    storyType:        storyType || 'general',
    accentColor:      getAccentColor(storyType),
    totalDurationSec: totalDuration + 4,
    fps:              FPS,
    modules,
    subtitles:        subtitleCues || [],
    audioSrc:         `assets/${jobKey}/narration.mp3`,
    brandName:        'QUYDLY',
    jobKey,
  };

  const propsFilePath = path.join(publicDir, 'render-props.json');
  fs.writeFileSync(propsFilePath, JSON.stringify(videoProps));

  const totalFrames     = Math.ceil((totalDuration + 4) * FPS);
  const rawOutputPath   = path.join(publicDir, 'render.mp4');
  const finalOutputPath = path.join(outputDir, `story-${storyId}-animated.mp4`);

  console.log(`[11-remotion-render] Rendering ${totalFrames} frames @ ${FPS}fps...`);

  const remotionBin = process.platform === 'win32'
    ? path.join(REMOTION_DIR, 'node_modules', '.bin', 'remotion.cmd')
    : path.join(REMOTION_DIR, 'node_modules', '.bin', 'remotion');

  const cmd = [
    `"${remotionBin}"`,
    'render',
    'src/Root.tsx',
    'ShortVideo',
    `"${rawOutputPath}"`,
    `"--props=${propsFilePath}"`,
    '--log=info',
    '--concurrency=1',
  ].join(' ');

  try {
    execSync(cmd, {
      cwd:     REMOTION_DIR,
      stdio:   'inherit',
      timeout: 600000,
      shell:   true,
    });
  } catch (err) {
    throw new Error(`[remotion-render] Render exited with code ${err.status ?? 'unknown'}`);
  }

  if (!fs.existsSync(rawOutputPath)) {
    throw new Error('[remotion-render] Output file not found after render');
  }

  fs.copyFileSync(rawOutputPath, finalOutputPath);
  console.log(`[11-remotion-render] ✓ Rendered → ${path.basename(finalOutputPath)}`);
  return { remotionVideoPath: finalOutputPath };
}

function prepareModuleProps(modulePlan, publicDir, jobKey) {
  return modulePlan.map(module => {
    let mapSrc = module.mapSrc || null;
    if (mapSrc && fs.existsSync(mapSrc)) {
      const destName = `module-${module.moduleId}-map.png`;
      const destPath = path.join(publicDir, destName);
      fs.copyFileSync(mapSrc, destPath);
      mapSrc = `assets/${jobKey}/${destName}`;
    }
    return { ...module, mapSrc };
  });
}

function ensureRemotionInstalled() {
  const nodeModules = path.join(REMOTION_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('[11-remotion-render] Installing Remotion dependencies (first run)...');
    execSync('npm install', { cwd: REMOTION_DIR, stdio: 'inherit', timeout: 120000 });
  }
}

module.exports = { run };
