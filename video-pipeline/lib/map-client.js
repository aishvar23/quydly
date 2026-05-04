'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const GEO_GAZETTEER = {
  'venezuela':       { lon: -66.879, lat: 10.480,  zoom: 4 },
  'caracas':         { lon: -66.879, lat: 10.480,  zoom: 7 },
  'washington dc':   { lon: -77.036, lat: 38.907,  zoom: 6 },
  'washington':      { lon: -77.036, lat: 38.907,  zoom: 6 },
  'united states':   { lon: -98.583, lat: 39.833,  zoom: 3 },
  'us':              { lon: -98.583, lat: 39.833,  zoom: 3 },
  'ukraine':         { lon:  31.165, lat: 48.379,  zoom: 4 },
  'russia':          { lon:  37.618, lat: 55.756,  zoom: 3 },
  'israel':          { lon:  34.851, lat: 31.046,  zoom: 6 },
  'gaza':            { lon:  34.465, lat: 31.501,  zoom: 8 },
  'china':           { lon: 116.383, lat: 39.916,  zoom: 3 },
  'taiwan':          { lon: 120.960, lat: 23.698,  zoom: 7 },
  'north korea':     { lon: 125.727, lat: 39.019,  zoom: 5 },
  'iran':            { lon:  51.389, lat: 35.689,  zoom: 4 },
  'india':           { lon:  78.963, lat: 20.594,  zoom: 3 },
  'europe':          { lon:  15.000, lat: 52.000,  zoom: 3 },
  'middle east':     { lon:  42.000, lat: 29.000,  zoom: 4 },
  'south china sea': { lon: 114.000, lat: 15.000,  zoom: 4 },
  'beijing':         { lon: 116.407, lat: 39.904,  zoom: 7 },
  'moscow':          { lon:  37.618, lat: 55.756,  zoom: 7 },
  'tehran':          { lon:  51.389, lat: 35.689,  zoom: 7 },
  'seoul':           { lon: 126.978, lat: 37.566,  zoom: 7 },
  'pyongyang':       { lon: 125.727, lat: 39.019,  zoom: 7 },
  'london':          { lon:  -0.118, lat: 51.508,  zoom: 7 },
  'paris':           { lon:   2.349, lat: 48.864,  zoom: 7 },
  'berlin':          { lon:  13.405, lat: 52.520,  zoom: 7 },
  'kyiv':            { lon:  30.523, lat: 50.450,  zoom: 7 },
};

const MAPBOX_STYLE = 'mapbox/dark-v10';

async function fetchMap(geoLocation, outputPath) {
  if (!process.env.MAPBOX_TOKEN) {
    console.warn('[map] MAPBOX_TOKEN not set — skipping map fetch');
    return null;
  }

  const key    = (geoLocation || '').toLowerCase().trim();
  const coords = GEO_GAZETTEER[key];
  if (!coords) {
    console.warn(`[map] No gazetteer entry for "${geoLocation}"`);
    return null;
  }

  const { lon, lat, zoom } = coords;
  const url = `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/${lon},${lat},${zoom},0/540x960@2x?access_token=${process.env.MAPBOX_TOKEN}`;

  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    fs.writeFileSync(outputPath, response.data);
    console.log(`[map] Downloaded map for "${geoLocation}" → ${path.basename(outputPath)}`);
    return outputPath;
  } catch (err) {
    console.warn(`[map] Mapbox fetch failed for "${geoLocation}": ${err.message}`);
    return null;
  }
}

module.exports = { fetchMap };
