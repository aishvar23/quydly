'use strict';

const axios     = require('axios');
const fs        = require('fs');
const path      = require('path');
const { getConcept, isVideoBlocked } = require('./visual-concept-map');
const { scoreVideo, scorePhoto, passesGate } = require('./asset-quality-gate');
const { SceneDiversityTracker }              = require('./scene-diversity');
const { fetchMap }                           = require('./map-fetcher');
const { generateFallbackImage }              = require('./ai-image-fallback');

const PEXELS_VIDEO_URL = 'https://api.pexels.com/videos/search';
const PEXELS_PHOTO_URL = 'https://api.pexels.com/v1/search';
const pexelsHeaders    = () => ({ Authorization: process.env.PEXELS_API_KEY });

async function resolveAllAssets(scenes, assetsDir) {
  fs.mkdirSync(assetsDir, { recursive: true });
  const tracker = new SceneDiversityTracker();
  const total   = scenes.length;

  for (let i = 0; i < total; i++) {
    const scene     = scenes[i];
    const remaining = total - i - 1;
    const forced    = tracker.getMixSuggestion(remaining);
    const treatment = getConcept(scene.safe_visual_concept).visual_treatment;

    console.log(`[assets] Scene ${scene.scene_id}: ${scene.safe_visual_concept} (${treatment})${forced ? ` forced=${forced}` : ''}`);

    const result = await resolveScene(scene, assetsDir, tracker, forced, treatment);
    Object.assign(scene, result);
    tracker.record(scene.asset_download_url || null, scene.asset_type);
  }

  return scenes;
}

async function resolveScene(scene, assetsDir, tracker, forcedType, treatment) {
  const conceptKey = scene.safe_visual_concept;
  const concept    = getConcept(conceptKey);
  const outBase    = path.join(assetsDir, `scene-${scene.scene_id}`);

  // Branded/abstract — never uses external assets
  if (treatment === 'branded' || treatment === 'abstract' || conceptKey === 'brand_outro') {
    return motionGraphicResult();
  }

  // Force override from diversity tracker
  if (forcedType === 'motion_graphic') return motionGraphicResult();
  if (forcedType === 'map') {
    const r = await tryMap(scene, outBase);
    if (r) return r;
  }

  // Geo map concept → Mapbox first
  if (treatment === 'map' || conceptKey === 'geo_map') {
    const r = await tryMap(scene, outBase);
    if (r) return r;
    // Fall through to stock if Mapbox unavailable
  }

  // Video — only for concepts where it's safe and not blocked
  const canUseVideo = concept.prefer === 'video' && !isVideoBlocked(conceptKey) && !!process.env.PEXELS_API_KEY;
  if (canUseVideo) {
    for (const query of concept.queries) {
      const r = await tryPexelsVideo(query, scene.duration_sec, outBase, tracker);
      if (r) return r;
    }
  }

  // Photo — all concepts
  if (process.env.PEXELS_API_KEY) {
    for (const query of concept.queries) {
      const r = await tryPexelsPhoto(query, outBase, tracker);
      if (r) return r;
    }
  }

  // DALL-E — conceptual/non-literal only, where allowed
  if (concept.dalle_allowed) {
    const dalleOut = `${outBase}-dalle.jpg`;
    const p = await generateFallbackImage(concept, dalleOut);
    if (p) {
      return {
        asset_path:            p,
        asset_type:            'photo',
        asset_download_url:    null,
        asset_quality_score:   0.8,
        asset_relevance_score: 0.8,
        asset_is_safe:         true,
        ken_burns:             randomKenBurns(),
      };
    }
  }

  // Terminal fallback: branded motion graphic
  console.warn(`[assets] Scene ${scene.scene_id}: all sources exhausted — motion graphic`);
  return motionGraphicResult();
}

async function tryMap(scene, outBase) {
  const mapPath = await fetchMap(scene.geo_location, `${outBase}-map.png`);
  if (!mapPath) return null;
  return {
    asset_path:            mapPath,
    asset_type:            'map',
    asset_download_url:    null,
    asset_quality_score:   1.0,
    asset_relevance_score: 1.0,
    asset_is_safe:         true,
    ken_burns:             { direction: 'zoom-in', start_scale: 1.04, end_scale: 1.0 },
  };
}

async function tryPexelsVideo(query, sceneDuration, outBase, tracker) {
  try {
    const resp = await axios.get(PEXELS_VIDEO_URL, {
      headers: pexelsHeaders(),
      params:  { query, per_page: 5, size: 'large', orientation: 'portrait' },
      timeout: 12000,
    });
    for (let idx = 0; idx < (resp.data?.videos || []).length; idx++) {
      const scored = scoreVideo(resp.data.videos[idx], sceneDuration, idx);
      if (!passesGate(scored)) continue;
      if (!tracker.canUse(scored.download_url, 'video')) continue;
      const dest = `${outBase}-video.mp4`;
      await downloadFile(scored.download_url, dest);
      return {
        asset_path:            dest,
        asset_type:            'video',
        asset_download_url:    scored.download_url,
        asset_quality_score:   scored.asset_quality_score,
        asset_relevance_score: scored.asset_relevance_score,
        asset_is_safe:         scored.asset_is_safe,
        ken_burns:             null,
      };
    }
  } catch (err) {
    console.warn(`[assets] Pexels video "${query}": ${err.message}`);
  }
  return null;
}

async function tryPexelsPhoto(query, outBase, tracker) {
  try {
    const resp = await axios.get(PEXELS_PHOTO_URL, {
      headers: pexelsHeaders(),
      params:  { query, per_page: 5, orientation: 'portrait' },
      timeout: 12000,
    });
    for (let idx = 0; idx < (resp.data?.photos || []).length; idx++) {
      const scored = scorePhoto(resp.data.photos[idx], idx);
      if (!passesGate(scored)) continue;
      if (!tracker.canUse(scored.download_url, 'photo')) continue;
      const dest = `${outBase}-photo.jpg`;
      await downloadFile(scored.download_url, dest);
      return {
        asset_path:            dest,
        asset_type:            'photo',
        asset_download_url:    scored.download_url,
        asset_quality_score:   scored.asset_quality_score,
        asset_relevance_score: scored.asset_relevance_score,
        asset_is_safe:         scored.asset_is_safe,
        ken_burns:             randomKenBurns(),
      };
    }
  } catch (err) {
    console.warn(`[assets] Pexels photo "${query}": ${err.message}`);
  }
  return null;
}

function motionGraphicResult() {
  return {
    asset_path:            null,
    asset_type:            'motion_graphic',
    asset_download_url:    null,
    asset_quality_score:   1.0,
    asset_relevance_score: 1.0,
    asset_is_safe:         true,
    ken_burns:             null,
  };
}

function randomKenBurns() {
  return Math.random() > 0.5
    ? { direction: 'zoom-in',  start_scale: 1.0,  end_scale: 1.06 }
    : { direction: 'zoom-out', start_scale: 1.06, end_scale: 1.0  };
}

async function downloadFile(url, dest) {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  fs.writeFileSync(dest, resp.data);
}

module.exports = { resolveAllAssets };
