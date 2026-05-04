'use strict';

const ffmpeg    = require('fluent-ffmpeg');
const ffmpegBin = require('@ffmpeg-installer/ffmpeg');
const path      = require('path');
const fs        = require('fs');
const { BRAND, getFontPath } = require('./brand');

ffmpeg.setFfmpegPath(ffmpegBin.path);

async function renderVideo(scenes, audioPath, subtitlePath, outputPath, thumbnailPath, isAudioStub) {
  const tmpDir = path.join(path.dirname(outputPath), 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const scenePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const p = await renderScene(scenes[i], i, tmpDir);
    scenePaths.push(p);
  }

  await composeFinal(scenePaths, audioPath, subtitlePath, outputPath, isAudioStub, scenes);
  await extractThumbnail(outputPath, thumbnailPath);

  scenePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  try { fs.rmdirSync(tmpDir); } catch {}

  return { videoPath: outputPath, thumbnailPath };
}

async function renderScene(scene, index, tmpDir) {
  const outPath      = path.join(tmpDir, `scene-${index}.mp4`);
  const font         = getFontPath().replace(/\\/g, '/');
  const dur          = scene.duration_sec;
  const isFirstScene = index === 0;
  const isOutro      = scene.type === 'outro' || scene.safe_visual_concept === 'brand_outro';

  let vf;
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    if (isOutro) {
      cmd
        .input(`color=c=${BRAND.BG_COLOR}:s=${BRAND.WIDTH}x${BRAND.HEIGHT}:r=${BRAND.FPS}`)
        .inputOptions(['-f', 'lavfi', '-t', String(dur)]);

      vf =
        `vignette=PI/4,` +
        `drawtext=text='${BRAND.NAME}':fontfile='${font}':fontsize=96:fontcolor=white` +
        `:x=(w-text_w)/2:y=h/2-60,` +
        `drawtext=text='Daily news\\, simplified.':fontfile='${font}':fontsize=32:fontcolor=white@0.55` +
        `:x=(w-text_w)/2:y=h/2+60`;

    } else if (scene.asset_type === 'motion_graphic') {
      cmd
        .input(`color=c=${BRAND.BG_COLOR}:s=${BRAND.WIDTH}x${BRAND.HEIGHT}:r=${BRAND.FPS}`)
        .inputOptions(['-f', 'lavfi', '-t', String(dur)]);

      vf = `vignette=PI/5,${buildOverlay(scene, font, isFirstScene)}`;

    } else if (scene.asset_type === 'video') {
      cmd
        .input(scene.asset_path)
        .inputOptions(['-t', String(dur + 0.5)]);

      vf =
        `scale=${BRAND.WIDTH}:${BRAND.HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${BRAND.WIDTH}:${BRAND.HEIGHT},` +
        // Subtle cinematic vignette on footage
        `vignette=PI/4,` +
        `trim=duration=${dur},setpts=PTS-STARTPTS,` +
        buildOverlay(scene, font, isFirstScene);

    } else {
      // photo or map — Ken Burns
      const zoomMax = isFirstScene ? BRAND.KB_SCENE1_ZOOM : BRAND.KB_DEFAULT_ZOOM;
      const padMult = isFirstScene ? 1.18 : 1.15;
      const padW    = Math.ceil(BRAND.WIDTH  * padMult);
      const padH    = Math.ceil(BRAND.HEIGHT * padMult);
      const frames  = Math.ceil(dur * BRAND.FPS);

      // Scene 1: always push-in (zoom in) for hook impact
      // Other scenes: use assigned ken_burns direction, or default to zoom-in
      const kb = isFirstScene
        ? { start_scale: 1.0, end_scale: zoomMax }
        : (scene.ken_burns || { start_scale: 1.0, end_scale: zoomMax });

      const zStart  = kb.start_scale;
      const zEnd    = kb.end_scale;
      const zpExpr  = zStart < zEnd
        ? `if(gte(zoom,${zEnd}),${zStart},min(${zEnd},zoom+0.0020))`
        : `if(lte(zoom,${zEnd}),${zStart},max(${zEnd},zoom-0.0020))`;

      cmd
        .input(scene.asset_path)
        .inputOptions(['-loop', '1', '-t', String(dur + 0.5)]);

      vf =
        `scale=${padW}:${padH}:force_original_aspect_ratio=increase,` +
        `crop=${padW}:${padH},` +
        `zoompan=z='${zpExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:fps=${BRAND.FPS}:s=${BRAND.WIDTH}x${BRAND.HEIGHT},` +
        `trim=duration=${dur},setpts=PTS-STARTPTS,` +
        `format=yuv420p,` +
        buildOverlay(scene, font, isFirstScene);
    }

    cmd
      .outputOptions([
        '-vf', vf,
        '-map', '0:v',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-an',
        '-r', String(BRAND.FPS),
      ])
      .output(outPath)
      .on('start', () => {
        const label = isOutro ? 'outro' : scene.asset_type;
        console.log(`  [ffmpeg] scene-${index} (${label}): ${dur.toFixed(1)}s`);
      })
      .on('error', (_err, _out, stderr) => reject(new Error(stderr || _err.message)))
      .on('end', () => resolve(outPath))
      .run();
  });
}

// Three-tier text hierarchy:
//   Tier 1 — Hook strap (scene 1, large, intentional)
//   Tier 2 — Editorial strap (other scenes, only ≤5-word overlays, suppressed on maps)
//   Tier 3 — Watermark (always, subtle)
function buildOverlay(scene, font, isFirstScene) {
  const raw   = (scene.overlay_text || '').trim();
  const words = raw.split(/\s+/).filter(Boolean);

  // Watermark — subtle, always present (not on outro, handled separately)
  const watermark =
    `drawtext=text='${BRAND.NAME}':fontfile='${font}':fontsize=${BRAND.WATERMARK_SIZE}` +
    `:fontcolor=white@${BRAND.WATERMARK_ALPHA}:x=w-text_w-24:y=20`;

  // Map scenes: clean location label strap — no editorial overlay.
  // Single-word geo_location only: this FFmpeg build mis-parses spaces inside
  // drawtext text= values on Windows, so multi-word names are suppressed to watermark.
  const isMap = scene.asset_type === 'map' || scene.safe_visual_concept === 'geo_map';
  if (isMap) {
    const geo = (scene.geo_location || '').trim();
    if (geo && !geo.includes(' ')) {
      const label = escapeDrawtext(toTitleCase(geo));
      const locationStrap =
        `drawtext=text='${label}':fontfile='${font}':fontsize=30:fontcolor=white@0.90` +
        `:x=(w-text_w)/2:y=h*0.86` +
        `:box=1:boxcolor=black@0.52:boxborderw=16`;
      return `${locationStrap},${watermark}`;
    }
    return watermark;
  }

  // No text or text too long: just watermark
  if (!raw || words.length === 0 || words.length > 7) return watermark;

  const text = escapeDrawtext(words.join(' '));

  // Tier 1: Hook overlay — scene 1 only
  if (isFirstScene) {
    const hookStrap =
      `drawtext=text='${text}':fontfile='${font}':fontsize=${BRAND.HOOK_FONT_SIZE}:fontcolor=white` +
      `:x=(w-text_w)/2:y=h*${BRAND.HOOK_OVERLAY_Y}` +
      `:box=1:boxcolor=${BRAND.HOOK_BOX_BG}:boxborderw=${BRAND.HOOK_BOX_PAD}`;
    return `${hookStrap},${watermark}`;
  }

  // Tier 2: Standard editorial strap — only short overlays (≤5 words), not motion graphic scenes
  // Motion graphic scenes show the strap since it's all we have visually
  if (words.length <= 5) {
    const strap =
      `drawtext=text='${text}':fontfile='${font}':fontsize=${BRAND.STRAP_FONT_SIZE}:fontcolor=white` +
      `:x=(w-text_w)/2:y=h*${BRAND.STRAP_OVERLAY_Y}` +
      `:box=1:boxcolor=${BRAND.STRAP_BOX_BG}:boxborderw=${BRAND.STRAP_BOX_PAD}`;
    return `${strap},${watermark}`;
  }

  return watermark;
}

async function composeFinal(scenePaths, audioPath, subtitlePath, outputPath, isAudioStub, scenes) {
  const totalDur   = scenes.reduce((s, sc) => s + sc.duration_sec, 0);
  const concatFile = outputPath.replace('.mp4', '-concat.txt');

  const manifest = scenePaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatFile, manifest);

  // V3 subtitle: FontSize=6 at ASS PlayResY=288 → ~40px on 1920 frame.
  // MarginV=14 at same scale → ~93px from bottom edge (slightly more breathing room).
  // MarginL/R=15 → ~100px side inset, reducing subtitle width slightly.
  // Outline-only style (BorderStyle=1) — no box, no background fill.
  const subFilter = subtitlePath
    ? `subtitles='${subtitlePath.replace(/\\/g, '/').replace(/^([A-Z]):/, '$1\\:')}':` +
      `force_style='FontName=Arial,FontSize=6,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,` +
      `BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=14,MarginL=15,MarginR=15'`
    : null;

  const vf = subFilter ? `null,${subFilter}` : 'null';

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(concatFile)
      .inputOptions(['-f', 'concat', '-safe', '0']);

    if (isAudioStub) {
      cmd
        .input('anullsrc=r=44100:cl=mono')
        .inputOptions(['-f', 'lavfi', '-t', String(totalDur)]);
    } else {
      cmd.input(audioPath);
    }

    cmd
      .outputOptions([
        '-vf', vf,
        '-map', '0:v',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-r', String(BRAND.FPS),
      ])
      .output(outputPath)
      .on('start', () => console.log('  [ffmpeg] final compose...'))
      .on('error', (_err, _out, stderr) => {
        try { fs.unlinkSync(concatFile); } catch {}
        reject(new Error(stderr || _err.message));
      })
      .on('end', () => {
        try { fs.unlinkSync(concatFile); } catch {}
        resolve();
      })
      .run();
  });
}

async function extractThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(['-ss', '00:00:01', '-frames:v', '1'])
      .output(thumbnailPath)
      .on('error', (_err, _out, stderr) => reject(new Error(stderr || _err.message)))
      .on('end', resolve)
      .run();
  });
}

function toTitleCase(str) {
  return (str || '').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function escapeDrawtext(text) {
  return (text || '').slice(0, 55)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019')
    .replace(/,/g, '\\,')
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

module.exports = { renderVideo };
