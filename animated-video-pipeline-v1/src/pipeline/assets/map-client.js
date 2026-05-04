'use strict';

const fs = require('fs');
const axios = require('axios');

const MAPBOX_STYLE = 'mapbox/dark-v11';

const GAZETTEER = {
  global: { lon: 0, lat: 20, zoom: 1.4 },
  'united states': { lon: -98.583, lat: 39.833, zoom: 3 },
  us: { lon: -98.583, lat: 39.833, zoom: 3 },
  india: { lon: 78.963, lat: 20.594, zoom: 3 },
  china: { lon: 104.195, lat: 35.862, zoom: 3 },
  europe: { lon: 15, lat: 52, zoom: 3 },
  russia: { lon: 37.618, lat: 55.756, zoom: 3 },
  ukraine: { lon: 31.165, lat: 48.379, zoom: 4 },
  israel: { lon: 34.851, lat: 31.046, zoom: 6 },
  gaza: { lon: 34.465, lat: 31.501, zoom: 8 },
  iran: { lon: 51.389, lat: 35.689, zoom: 4 },
  taiwan: { lon: 120.96, lat: 23.698, zoom: 6 },
  venezuela: { lon: -66.879, lat: 10.48, zoom: 4 },
  caracas: { lon: -66.879, lat: 10.48, zoom: 7 },
};

function hasMapbox() {
  return Boolean(process.env.MAPBOX_TOKEN);
}

async function fetchMap({ geoLocation, outputPath }) {
  if (!hasMapbox()) return null;

  const coords = lookup(geoLocation);
  if (!coords) return null;

  const url = [
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static`,
    `/${coords.lon},${coords.lat},${coords.zoom},0/540x960@2x`,
    `?access_token=${encodeURIComponent(process.env.MAPBOX_TOKEN)}`,
  ].join('');

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 18000,
  });
  fs.writeFileSync(outputPath, response.data);

  return {
    kind: 'map',
    path: outputPath,
    sourceUrl: null,
    width: 1080,
    height: 1920,
    duration: null,
  };
}

function lookup(geoLocation) {
  const key = String(geoLocation || 'global').toLowerCase().trim();
  return GAZETTEER[key] || null;
}

module.exports = {
  GAZETTEER,
  hasMapbox,
  fetchMap,
};
