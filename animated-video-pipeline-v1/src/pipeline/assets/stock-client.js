'use strict';

const fs = require('fs');
const axios = require('axios');

const PEXELS_VIDEO_URL = 'https://api.pexels.com/videos/search';
const PEXELS_PHOTO_URL = 'https://api.pexels.com/v1/search';

function hasPexels() {
  return Boolean(process.env.PEXELS_API_KEY);
}

async function findStockAsset({ query, kind, outputPath, blockedTerms = [] }) {
  if (!hasPexels()) return null;

  if (kind === 'video') {
    return findVideo(query, outputPath, blockedTerms);
  }

  return findPhoto(query, outputPath, blockedTerms);
}

async function findVideo(query, outputPath, blockedTerms) {
  const response = await axios.get(PEXELS_VIDEO_URL, {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query, per_page: 5, orientation: 'portrait', size: 'large' },
    timeout: 15000,
  });

  for (const video of response.data.videos || []) {
    if (!isSafe(`${video.url}`, blockedTerms)) continue;
    const file = chooseVideoFile(video.video_files || []);
    if (!file || !isSafe(file.link, blockedTerms)) continue;
    await download(file.link, outputPath);
    return {
      kind: 'video',
      path: outputPath,
      sourceUrl: file.link,
      width: file.width,
      height: file.height,
      duration: video.duration,
    };
  }

  return null;
}

async function findPhoto(query, outputPath, blockedTerms) {
  const response = await axios.get(PEXELS_PHOTO_URL, {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query, per_page: 5, orientation: 'portrait' },
    timeout: 15000,
  });

  for (const photo of response.data.photos || []) {
    const sourceUrl = photo.src?.large2x || photo.src?.large || photo.src?.original;
    if (!sourceUrl || !isSafe(`${photo.url} ${photo.alt}`, blockedTerms)) continue;
    await download(sourceUrl, outputPath);
    return {
      kind: 'photo',
      path: outputPath,
      sourceUrl,
      width: photo.width,
      height: photo.height,
      duration: null,
    };
  }

  return null;
}

function chooseVideoFile(files) {
  return files
    .filter((file) => file.link && file.width >= 720)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null;
}

function isSafe(text, blockedTerms) {
  const corpus = String(text).toLowerCase();
  return !blockedTerms.some((term) => term && corpus.includes(String(term).toLowerCase()));
}

async function download(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  fs.writeFileSync(outputPath, response.data);
}

module.exports = {
  hasPexels,
  findStockAsset,
};
