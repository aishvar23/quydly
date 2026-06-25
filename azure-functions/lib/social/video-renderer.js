// video-renderer.js — render carousel slide frames into a 9:16 Reel MP4 with a
// single royalty-free music bed. Reuses the POC's ffmpeg approach
// (poc-video-story-288) — Ken-Burns-style motion + xfade crossfades, H.264/AAC,
// yuv420p, +faststart (the exact Reels-compatible profile) — but is BUFFER-driven
// and lays ONE music bed over the whole reel (no per-scene TTS).
//
// Motion note: unlike the photo-oriented POC, our slides are data-dense
// infographics (score, table, form). A big zoom would crop the score/table and a
// pan would make text drift, so we use a GENTLE CENTERED zoom only (~4%, well
// inside the slides' safe margins) — readability first.
//
// ffmpeg is a NATIVE binary (ffmpeg-static). Import this module LAZILY behind the
// Reels flag so a wrong-arch binary can never break the generator (same rule the
// renderer/resvg path follows).

import { writeFile, mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const W = 1080;
const H = 1920;
const FPS = 30;
const XFADE = 0.6; // crossfade seconds between slides
const DEFAULT_SLIDE_SEC = 3.2; // per-slide hold (enough to read a table)

function run(setup, label) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    setup(cmd);
    let err = "";
    cmd.on("stderr", (l) => { err += l + "\n"; })
      .on("end", () => resolve())
      .on("error", (e) => reject(new Error(`[video-renderer:${label}] ${e.message}\n${err.slice(-1200)}`)))
      .run();
  });
}

// Gentle CENTERED zoom for the BLURRED backdrop only (the sharp card stays still
// and fully readable). Alternates in/out per scene for subtle life.
function gentleBgZoom(idx, frames) {
  const zoomIn = idx % 2 === 0;
  const z = zoomIn ? `1+0.06*on/${frames}` : `1.06-0.06*on/${frames}`;
  return `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`;
}

// Compose one 4:5 slide (1080×1350) into a 9:16 scene: a blurred, gently-moving
// extension of the SAME frame fills the 1080×1920 backdrop, with the SHARP 4:5
// card centered on top. This reuses the proven 4:5 layout (readable, in the
// Reels-safe centre) while filling the frame immersively — no dead bands.
async function renderScene(imgPath, idx, slideSec, tmp) {
  const frames = Math.ceil(slideSec * FPS);
  const out = join(tmp, `scene-${String(idx).padStart(2, "0")}.mp4`);
  await run((cmd) => {
    cmd.input(imgPath).inputOptions(["-loop 1", `-t ${slideSec.toFixed(3)}`]);
    cmd.complexFilter([
      "[0:v]split=2[s0][s1]",
      `[s0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,boxblur=26:3,eq=brightness=-0.12:saturation=1.05[bgsrc]`,
      `[bgsrc]${gentleBgZoom(idx, frames)}[bg]`,
      `[s1]scale=${W}:-1:flags=lanczos,setsar=1[fg]`,
      "[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v]",
    ]);
    cmd.outputOptions(["-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an", "-t", slideSec.toFixed(3)]);
    cmd.output(out);
  }, `scene-${idx}`);
  return out;
}

// Crossfade-concat the silent scenes into one silent master clip.
async function xfadeConcat(scenePaths, slideSec, outFile) {
  if (scenePaths.length === 1) {
    await run((cmd) => { cmd.input(scenePaths[0]).outputOptions(["-c", "copy", "-movflags", "+faststart"]).output(outFile); }, "single");
    return;
  }
  await run((cmd) => {
    scenePaths.forEach((p) => cmd.input(p));
    const filters = [];
    let cur = "0:v";
    let off = slideSec;
    for (let i = 1; i < scenePaths.length; i++) {
      const next = `vx${i}`;
      filters.push(`[${cur}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${(off - XFADE).toFixed(3)}[${next}]`);
      cur = next;
      off += slideSec - XFADE;
    }
    cmd.complexFilter(filters);
    cmd.outputOptions(["-map", `[${cur}]`, "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart"]);
    cmd.output(outFile);
  }, "xfade");
}

// Lay the music bed (looped to cover the video) over the silent master, with a
// short fade in and fade out, trimmed to the video length.
async function muxMusic(silentPath, musicPath, durSec, outFile) {
  const fadeOut = Math.max(0, durSec - 0.8);
  await run((cmd) => {
    cmd.input(silentPath);
    cmd.input(musicPath).inputOptions(["-stream_loop", "-1"]);
    cmd.audioFilters(`afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOut.toFixed(2)}:d=0.8`);
    cmd.outputOptions(["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-shortest", "-movflags", "+faststart"]);
    cmd.output(outFile);
  }, "mux");
}

// Render the football (or any) carousel frames into a 9:16 Reel MP4.
// frames: array of { buffer } or raw Buffers (JPEG/PNG), in slide order.
// musicPath: path to a royalty-free MP3 bed, or null for a silent reel.
// Returns { buffer, contentType:"video/mp4", width, height, durationSec, slideSec }.
export async function renderReelVideo(story, { frames, musicPath = null, slideSec = DEFAULT_SLIDE_SEC } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("renderReelVideo: no frames");
  const tmp = await mkdtemp(join(tmpdir(), "quydly-reel-"));
  try {
    const imgPaths = [];
    for (let i = 0; i < frames.length; i++) {
      const p = join(tmp, `frame-${String(i).padStart(2, "0")}.jpg`);
      await writeFile(p, frames[i]?.buffer || frames[i]);
      imgPaths.push(p);
    }
    const scenes = [];
    for (let i = 0; i < imgPaths.length; i++) scenes.push(await renderScene(imgPaths[i], i, slideSec, tmp));

    const silent = join(tmp, "silent.mp4");
    await xfadeConcat(scenes, slideSec, silent);

    const durSec = frames.length * slideSec - (frames.length - 1) * XFADE;
    const outFile = join(tmp, "reel.mp4");
    if (musicPath) await muxMusic(silent, musicPath, durSec, outFile);
    else await run((cmd) => { cmd.input(silent).outputOptions(["-c", "copy", "-movflags", "+faststart"]).output(outFile); }, "nomux");

    const buffer = await readFile(outFile);
    return { buffer, contentType: "video/mp4", width: W, height: H, durationSec: Math.round(durSec * 100) / 100, slideSec };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
