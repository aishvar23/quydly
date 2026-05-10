'use strict';

const fs = require('fs');
const path = require('path');
const { APP_ROOT, RENDER } = require('../../shared/config');
const { getAccentColor } = require('../../shared/brand');
const { pickMusicTrack } = require('../../integrations/music');

// Build the JSON props the Remotion CLI hands to <EvidenceVideo>.
// Keep the public/jobs/{jobKey}/ tree so any audio or asset URLs resolve via staticFile.
function prepareRenderProps(storyPackage, outputDir) {
  const jobKey = safeName(`story-${storyPackage.story.id}-${storyPackage.version || 'v1'}`);
  const publicDir = path.join(APP_ROOT, 'public', 'jobs', jobKey);
  fs.mkdirSync(publicDir, { recursive: true });

  const audioSrc = copyAudio(storyPackage.voice?.audioPath, publicDir, jobKey);
  const musicSrc = copyMusic(storyPackage.script.story_type, publicDir, jobKey);

  // Time ranges where the subtitle layer must hide. Built from the
  // modules that flagged subtitleSuppress so QuoteCard / NumberCard
  // / ChargeCard (which carry their meaning at large type already)
  // don't get a subtitle bar painted over them.
  const subtitleBlackouts = storyPackage.modules
    .filter((m) => m.subtitleSuppress)
    .map((m) => ({ startSec: m.startSec, endSec: m.endSec }));

  const props = {
    storyType: storyPackage.script.story_type,
    accentColor: getAccentColor(storyPackage.script.story_type),
    totalDurationSec: storyPackage.totalDurationSec,
    fps: RENDER.fps,
    audioSrc,
    musicSrc,
    brandName: 'QUYDLY',
    jobKey,
    publishedDate: formatPublishedDate(storyPackage.story?.published_at),
    // Persistent geo chrome — null when the story has no resolvable country.
    primaryCountry: storyPackage.story?.primary_country || null,
    modules: storyPackage.modules.map((module) => ({
      moduleId: module.moduleId,
      role: module.role,
      componentType: module.componentType,
      startSec: module.startSec,
      durationSec: module.durationSec,
      overlayText: module.overlayText || '',
      narration: module.narration || '',
      assetClass: module.assetClass || 'graphic',
      data: module.data || {},
      asset: copyModuleAsset(module.asset, module.moduleId, publicDir, jobKey),
    })),
    subtitles: storyPackage.subtitles || [],
    subtitleBlackouts,
    evidenceSources: storyPackage.evidencePackage?.source_documents || [],
    safetyNotes: storyPackage.evidencePackage?.safety_notes || [],
  };

  const propsPath = path.join(outputDir, 'render-props.json');
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), 'utf8');

  return { props, propsPath, publicDir, jobKey };
}

function copyAudio(audioPath, publicDir, jobKey) {
  if (!audioPath) return null;
  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) return null;
  const dest = path.join(publicDir, 'narration.mp3');
  fs.copyFileSync(audioPath, dest);
  return path.posix.join('jobs', jobKey, 'narration.mp3');
}

// Pick a music bed for the story type and copy it into the job's public/
// directory. Returns the staticFile-relative path or null when no bed is
// available for the type (and no default). User drops their own license-
// cleared MP3s into public/music/<story_type>/ — the pipeline ships no
// audio of its own.
function copyMusic(storyType, publicDir, jobKey) {
  const appPublicDir = path.join(APP_ROOT, 'public');
  const pick = pickMusicTrack(storyType, { publicDir: appPublicDir });
  if (!pick) return null;
  if (!fs.existsSync(pick.path)) return null;
  const ext = path.extname(pick.path).toLowerCase() || '.mp3';
  const dest = path.join(publicDir, `music${ext}`);
  fs.copyFileSync(pick.path, dest);
  return path.posix.join('jobs', jobKey, `music${ext}`);
}

// Copy a fetched asset (e.g. a Mapbox PNG) into public/jobs/{jobKey}/ and
// return an asset object with src set to the staticFile-relative path.
function copyModuleAsset(asset, moduleId, publicDir, jobKey) {
  const fallback = { kind: 'graphic', src: null, safetyClass: 'graphic' };
  if (!asset) return fallback;
  if (!asset.path || !fs.existsSync(asset.path)) {
    return { ...asset, src: null };
  }
  const ext = path.extname(asset.path) || '.asset';
  const filename = `module-${moduleId}${ext}`;
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

// Format the story's published_at ISO date as "Mon DD, YYYY" for the
// always-visible top-right chrome. Returns null when no publish date
// is on the story.
function formatPublishedDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch (_) {
    return null;
  }
}

module.exports = { prepareRenderProps };
