'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');
const { getAccentColor } = require('../../lib/brand-config');

const FPS          = 30;
const REMOTION_DIR = path.resolve(__dirname, '../../remotion');

async function run(ctx) {
  const { script, storyId, audioPath, subtitleCues, totalDuration, storyType, outputDir, version } = ctx;

  console.log('[08-remotion-render] Preparing Remotion render...');

  ensureRemotionInstalled();

  // Copy all assets to remotion/public/ so Remotion's dev server can serve them
  const jobKey    = `story-${storyId}-${version}`;
  const publicDir = path.join(REMOTION_DIR, 'public', 'assets', jobKey);
  fs.mkdirSync(publicDir, { recursive: true });

  const scenes = prepareSceneProps(script.scenes, publicDir, jobKey, storyType);

  // Copy audio
  const audioDest = path.join(publicDir, 'narration.mp3');
  if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) {
    fs.copyFileSync(audioPath, audioDest);
  }

  const totalFrames = Math.ceil(totalDuration * FPS) + FPS * 4; // +4s for outro

  const videoProps = {
    storyType:       storyType || 'general',
    accentColor:     getAccentColor(storyType),
    totalDurationSec: totalDuration + 4,
    fps:             FPS,
    scenes,
    subtitles:       subtitleCues || [],
    audioSrc:        `assets/${jobKey}/narration.mp3`,
    brandName:       'QUYDLY',
    jobKey,
  };

  const propsPath = path.join(publicDir, 'props.json');
  fs.writeFileSync(propsPath, JSON.stringify(videoProps, null, 2));

  const rawOutputPath   = path.join(publicDir, 'render.mp4');
  const finalOutputPath = path.join(outputDir, `story-${storyId}-animated.mp4`);

  console.log(`[08-remotion-render] Rendering ${totalFrames} frames @ ${FPS}fps...`);

  // Write props to a file and pass via --props flag to avoid shell quoting issues
  const propsFilePath = path.join(publicDir, 'render-props.json');
  fs.writeFileSync(propsFilePath, JSON.stringify(videoProps));

  // Use local remotion binary — works on Windows (.cmd) and Unix
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

  // inherit stdio so Remotion's progress stream directly to console and avoids
  // buffer exhaustion from verbose Chromium stderr captured by execSync
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

  console.log(`[08-remotion-render] ✓ Rendered → ${path.basename(finalOutputPath)}`);
  return { remotionVideoPath: finalOutputPath };
}

function prepareSceneProps(scenes, publicDir, jobKey, storyType) {
  return scenes.map(scene => {
    let assetSrc = null;

    if (scene.asset_path && fs.existsSync(scene.asset_path)) {
      const ext      = path.extname(scene.asset_path);
      const destName = `scene-${scene.scene_id}-asset${ext}`;
      const destPath = path.join(publicDir, destName);
      fs.copyFileSync(scene.asset_path, destPath);
      assetSrc = `assets/${jobKey}/${destName}`;
    }

    // Derive charges array from narration when scene purpose is list_charges
    const charges = deriveCharges(scene);

    return {
      sceneId:       scene.scene_id,
      componentType: scene.component_type || 'ContextScene',
      type:          scene.type,
      startSec:      scene.start_time_sec,
      endSec:        scene.end_time_sec,
      durationSec:   scene.duration_sec,
      overlayText:   scene.overlay_text || '',
      scenePurpose:  scene.scene_purpose,
      assetSrc,
      assetType:     scene.asset_type || 'motion_graphic',
      kenBurns:      scene.ken_burns || null,
      geoLocation:   scene.geo_location || null,
      storyType:     storyType || 'general',
      charges:       charges.length > 0 ? charges : undefined,
    };
  });
}

function deriveCharges(scene) {
  // If charges are already explicit in the scene data, use them
  if (Array.isArray(scene.charges) && scene.charges.length > 0) return scene.charges;
  // For list_charges purpose, try to split the narration on "," or "and"
  if (scene.scene_purpose === 'list_charges' && scene.narration_segment) {
    const raw = scene.narration_segment
      .replace(/^[^:]+:\s*/i, '') // strip "faces charges including: ..." prefix
      .split(/,\s*|\s+and\s+/)
      .map(s => s.trim().replace(/\.$/, ''))
      .filter(s => s.length > 4 && s.length < 80);
    if (raw.length > 1) return raw;
  }
  return [];
}

function ensureRemotionInstalled() {
  const nodeModules = path.join(REMOTION_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('[08-remotion-render] Installing Remotion dependencies (first run)...');
    execSync('npm install', { cwd: REMOTION_DIR, stdio: 'inherit', timeout: 120000 });
  }
}

module.exports = { run };
