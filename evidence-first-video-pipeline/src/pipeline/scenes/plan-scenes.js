'use strict';

const { getSceneType } = require('./scene-types');

function planScenes({ story, script, voice, audienceGeo }) {
  const templateScenes = script.template.scenes;
  const narrationScenes = templateScenes.filter((scene) => scene.role !== 'outro');
  const narrationChunks = splitIntoChunks(script.full_script, narrationScenes.length);
  const totalNarration = voice.totalDurationSec;
  const totalWords = narrationChunks.reduce((sum, chunk) => sum + wordCount(chunk), 0) || 1;
  let cursor = 0;

  const planned = templateScenes.map((templateScene, index) => {
    const sceneTypeConfig = getSceneType(templateScene.sceneType);
    const isOutro = templateScene.role === 'outro';
    const narration = isOutro ? '' : narrationChunks.shift();
    const words = wordCount(narration);
    const durationSec = isOutro
      ? 4
      : Math.max(3.4, (words / totalWords) * totalNarration);
    const startSec = cursor;
    cursor += durationSec;

    return {
      sceneId: index + 1,
      role: templateScene.role,
      componentType: sceneTypeConfig.componentType,
      sceneType: templateScene.sceneType,
      visualType: sceneTypeConfig.visualType,
      safetyClass: sceneTypeConfig.safetyClass,
      assetClass: sceneTypeConfig.assetClass,
      purpose: templateScene.purpose,
      startSec: round(startSec),
      durationSec: round(durationSec),
      endSec: round(startSec + durationSec),
      overlayText: overlayForScene(script, story, index),
      narration,
      geoLocation: chooseGeo(story, audienceGeo, templateScene.sceneType),
      asset: {
        kind: sceneTypeConfig.preferredAsset === 'motion' ? 'branded' : sceneTypeConfig.preferredAsset,
        src: null,
        safetyClass: sceneTypeConfig.safetyClass,
      },
    };
  });

  return {
    scenes: planned,
    totalDurationSec: round(cursor),
  };
}

function splitIntoChunks(text, count) {
  const words = text.split(/\s+/).filter(Boolean);
  const target = Math.ceil(words.length / count);
  const chunks = [];
  for (let i = 0; i < count; i++) {
    chunks.push(words.slice(i * target, (i + 1) * target).join(' '));
  }
  return chunks;
}

function overlayForScene(script, story, index) {
  return trimWords(script.overlay_phrases[index] || story.headline, 5);
}

function chooseGeo(story, audienceGeo, sceneType) {
  if (sceneType !== 'map_context') return null;
  const corpus = [story.headline, story.summary, ...(story.key_points || [])].join(' ').toLowerCase();
  if (corpus.includes('caracas')) return 'Caracas';
  if (corpus.includes('venezuela')) return 'Venezuela';
  return (story.primary_geos && story.primary_geos[0]) || audienceGeo || 'Global';
}

function trimWords(text, maxWords) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');
}

function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function round(value) {
  return Number(value.toFixed(3));
}

module.exports = {
  planScenes,
};
