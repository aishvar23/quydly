'use strict';

// Named entities from this story that must not appear in asset metadata.
// Expand this dynamically from story.key_points in production.
const STORY_NAMED_ENTITIES = [
  'van dyke', 'gannon', 'maduro', 'nicolas maduro',
];

const QUALITY_THRESHOLD    = 0.5;
const RELEVANCE_POSITION   = [1.0, 0.85, 0.7, 0.55, 0.4]; // index → relevance score

// Score a Pexels video result.
function scoreVideo(video, sceneDuration, resultIndex) {
  const file =
    video.video_files?.find(f => f.quality === 'uhd' || f.quality === 'hd') ||
    video.video_files?.[0];
  if (!file) return null;

  const resScore  = file.width >= 1920 ? 1.0 : file.width >= 1280 ? 0.7 : 0.3;
  const durScore  = video.duration >= sceneDuration + 2 ? 1.0
    : video.duration >= sceneDuration ? 0.7
    : 0.4;
  const qualScore = resScore * 0.6 + durScore * 0.4;
  const relScore  = RELEVANCE_POSITION[Math.min(resultIndex, 4)] ?? 0.3;
  const isSafe    = checkAssetSafety(video.url || '', file.link || '');

  return {
    asset_quality_score:   parseFloat(qualScore.toFixed(2)),
    asset_relevance_score: relScore,
    asset_is_safe:         isSafe,
    download_url:          file.link,
    width:                 file.width,
    height:                file.height,
    duration:              video.duration,
    asset_type:            'video',
  };
}

// Score a Pexels photo result.
function scorePhoto(photo, resultIndex) {
  const resScore  = photo.width >= 2000 ? 1.0 : photo.width >= 1080 ? 0.7 : 0.3;
  const relScore  = RELEVANCE_POSITION[Math.min(resultIndex, 4)] ?? 0.3;
  const isSafe    = checkAssetSafety(photo.url || '', photo.alt || '');
  const url       = photo.src?.large2x || photo.src?.large || photo.src?.original;

  return {
    asset_quality_score:   parseFloat(resScore.toFixed(2)),
    asset_relevance_score: relScore,
    asset_is_safe:         isSafe,
    download_url:          url,
    width:                 photo.width,
    height:                photo.height,
    asset_type:            'photo',
  };
}

// Returns false if the asset metadata references a named story entity,
// which could imply direct footage of the event.
function checkAssetSafety(url, altText) {
  const combined = `${url} ${altText}`.toLowerCase();
  return !STORY_NAMED_ENTITIES.some(entity => combined.includes(entity));
}

function passesGate(scored) {
  if (!scored) return false;
  return (
    scored.asset_quality_score   >= QUALITY_THRESHOLD &&
    scored.asset_relevance_score >= 0.4 &&
    scored.asset_is_safe
  );
}

module.exports = { scoreVideo, scorePhoto, passesGate, QUALITY_THRESHOLD };
