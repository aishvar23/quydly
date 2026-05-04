'use strict';

const fs = require('fs');
const path = require('path');
const { getSceneType } = require('../scenes/scene-types');
const { findStockAsset } = require('./stock-client');
const { fetchMap } = require('./map-client');

async function resolveAssets(storyPackage, outputDir, { dryRun = false } = {}) {
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const blockedTerms = [
    ...(storyPackage.story.primary_entities || []),
    storyPackage.story.headline,
  ].filter(Boolean);

  const scenes = [];
  for (const scene of storyPackage.scenes) {
    scenes.push(await resolveScene(scene, assetsDir, blockedTerms, dryRun));
  }

  return {
    ...storyPackage,
    scenes,
  };
}

async function resolveScene(scene, assetsDir, blockedTerms, dryRun) {
  const config = getSceneType(scene.sceneType);
  if (dryRun) return withFallback(scene, config, 'dry_run');

  if (config.preferredAsset === 'map') {
    const mapAsset = await safeAttempt(() => fetchMap({
      geoLocation: scene.geoLocation,
      outputPath: path.join(assetsDir, `scene-${scene.sceneId}-map.png`),
    }));
    if (mapAsset) return withAsset(scene, config, mapAsset);
  }

  if (config.preferredAsset === 'video' && config.allowVideo) {
    const video = await firstStock(config.queryTemplates, 'video', scene, assetsDir, blockedTerms);
    if (video) return withAsset(scene, config, video);
  }

  if (config.preferredAsset === 'photo' || config.queryTemplates.length > 0) {
    const photo = await firstStock(config.queryTemplates, 'photo', scene, assetsDir, blockedTerms);
    if (photo) return withAsset(scene, config, photo);
  }

  return withFallback(scene, config, 'branded_motion_fallback');
}

async function firstStock(queries, kind, scene, assetsDir, blockedTerms) {
  for (const query of queries) {
    const ext = kind === 'video' ? 'mp4' : 'jpg';
    const asset = await safeAttempt(() => findStockAsset({
      query,
      kind,
      outputPath: path.join(assetsDir, `scene-${scene.sceneId}-${kind}.${ext}`),
      blockedTerms,
    }));
    if (asset) return asset;
  }
  return null;
}

function withAsset(scene, config, asset) {
  return {
    ...scene,
    asset: {
      kind: asset.kind,
      src: null,
      path: asset.path,
      sourceUrl: asset.sourceUrl,
      safetyClass: config.safetyClass,
      fallbackReason: null,
    },
  };
}

function withFallback(scene, config, reason) {
  return {
    ...scene,
    asset: {
      kind: config.preferredAsset === 'map' ? 'map' : 'branded',
      src: null,
      path: null,
      sourceUrl: null,
      safetyClass: config.safetyClass,
      fallbackReason: reason,
    },
  };
}

async function safeAttempt(fn) {
  try {
    return await fn();
  } catch (error) {
    return null;
  }
}

module.exports = {
  resolveAssets,
};
