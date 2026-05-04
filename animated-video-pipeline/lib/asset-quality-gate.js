'use strict';

const QUALITY_THRESHOLD  = 0.5;
const RELEVANCE_POSITION = [1.0, 0.85, 0.7, 0.55, 0.4];

// Named entities that must not appear in asset metadata — prevents implying direct footage.
// Extend dynamically from story.primary_entities in production.
const DEFAULT_BLOCKED = ['van dyke', 'gannon', 'maduro', 'nicolas maduro'];

function buildGate(storyEntities = []) {
  const blocked = [...DEFAULT_BLOCKED, ...storyEntities.map(e => e.toLowerCase())];

  function checkSafety(url, altText) {
    const combined = `${url} ${altText}`.toLowerCase();
    return !blocked.some(entity => combined.includes(entity));
  }

  function scoreVideo(video, sceneDuration, resultIndex) {
    const file = video.video_files?.find(f => f.quality === 'uhd' || f.quality === 'hd') || video.video_files?.[0];
    if (!file) return null;
    const resScore  = file.width >= 1920 ? 1.0 : file.width >= 1280 ? 0.7 : 0.3;
    const durScore  = video.duration >= sceneDuration + 2 ? 1.0 : video.duration >= sceneDuration ? 0.7 : 0.4;
    const qualScore = resScore * 0.6 + durScore * 0.4;
    const relScore  = RELEVANCE_POSITION[Math.min(resultIndex, 4)] ?? 0.3;
    return {
      asset_quality_score:   parseFloat(qualScore.toFixed(2)),
      asset_relevance_score: relScore,
      asset_is_safe:         checkSafety(video.url || '', file.link || ''),
      download_url:          file.link,
      width:                 file.width,
      height:                file.height,
      duration:              video.duration,
      asset_type:            'video',
    };
  }

  function scorePhoto(photo, resultIndex) {
    const resScore = photo.width >= 2000 ? 1.0 : photo.width >= 1080 ? 0.7 : 0.3;
    const relScore = RELEVANCE_POSITION[Math.min(resultIndex, 4)] ?? 0.3;
    const url      = photo.src?.large2x || photo.src?.large || photo.src?.original;
    return {
      asset_quality_score:   parseFloat(resScore.toFixed(2)),
      asset_relevance_score: relScore,
      asset_is_safe:         checkSafety(photo.url || '', photo.alt || ''),
      download_url:          url,
      width:                 photo.width,
      height:                photo.height,
      asset_type:            'photo',
    };
  }

  function passesGate(scored) {
    if (!scored) return false;
    return (
      scored.asset_quality_score   >= QUALITY_THRESHOLD &&
      scored.asset_relevance_score >= 0.4 &&
      scored.asset_is_safe
    );
  }

  return { scoreVideo, scorePhoto, passesGate };
}

module.exports = { buildGate, QUALITY_THRESHOLD };
