'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

async function resolveEntityImage({ entityName, outputPath }) {
  if (!entityName) return null;

  const page = await findWikipediaPage(entityName);
  if (!page?.pageimage) return null;

  const image = await fetchImageInfo(page.pageimage);
  const imageUrl = image?.url || page.thumbnail?.source;
  if (!imageUrl) return null;

  const finalOutputPath = ensureExtension(outputPath, imageUrl);
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 25000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'QuydlyEvidenceFirstPipeline/0.1' },
  });

  fs.writeFileSync(finalOutputPath, response.data);

  return {
    kind: 'photo',
    path: finalOutputPath,
    sourceUrl: imageUrl,
    sourcePage: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    credit: cleanCredit(image?.artist || image?.credit || 'Wikipedia / Wikimedia Commons'),
    license: image?.license || 'Wikipedia page image; license metadata unavailable',
    subject: entityName,
  };
}

async function findWikipediaPage(entityName) {
  const response = await axios.get(WIKIPEDIA_API, {
    timeout: 15000,
    headers: { 'User-Agent': 'QuydlyEvidenceFirstPipeline/0.1' },
    params: {
      action: 'query',
      generator: 'search',
      gsrsearch: entityName,
      gsrlimit: 1,
      prop: 'pageimages|info',
      piprop: 'thumbnail|name|original',
      pithumbsize: 1000,
      inprop: 'url',
      redirects: 1,
      format: 'json',
    },
  });

  const pages = response.data?.query?.pages || {};
  const page = Object.values(pages)[0] || null;
  return page && titleMatchesEntity(page.title, entityName) ? page : null;
}

async function fetchImageInfo(pageImage) {
  const title = pageImage.startsWith('File:') ? pageImage : `File:${pageImage}`;
  const response = await axios.get(WIKIPEDIA_API, {
    timeout: 15000,
    headers: { 'User-Agent': 'QuydlyEvidenceFirstPipeline/0.1' },
    params: {
      action: 'query',
      titles: title,
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      format: 'json',
    },
  });

  const pages = response.data?.query?.pages || {};
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  const meta = info?.extmetadata || {};

  return {
    url: info?.url,
    artist: meta.Artist?.value,
    credit: meta.Credit?.value,
    license: meta.LicenseShortName?.value || meta.UsageTerms?.value,
  };
}

function ensureExtension(outputPath, sourceUrl) {
  const ext = extensionFor(sourceUrl);
  if (path.extname(outputPath)) {
    return outputPath.replace(/\.[^.]+$/, ext);
  }
  return `${outputPath}${ext}`;
}

function extensionFor(sourceUrl) {
  const clean = String(sourceUrl || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return '.png';
  if (clean.endsWith('.webp')) return '.webp';
  if (clean.endsWith('.jpeg')) return '.jpg';
  if (clean.endsWith('.jpg')) return '.jpg';
  return '.jpg';
}

function cleanCredit(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Wikipedia / Wikimedia Commons';
}

function titleMatchesEntity(title, entityName) {
  const titleText = normalizeName(title);
  const tokens = normalizeName(entityName)
    .split(' ')
    .filter((token) => token.length > 1);
  if (!titleText || !tokens.length) return false;
  return tokens.every((token) => titleText.includes(token));
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

module.exports = {
  resolveEntityImage,
};
