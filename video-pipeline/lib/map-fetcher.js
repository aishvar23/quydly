'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

// Simple gazetteer for story-relevant geo locations.
// Extend this as the pipeline covers more story types.
const GEO_GAZETTEER = {
  'venezuela':       { lon: -66.879, lat: 10.480, zoom: 4 },
  'caracas':         { lon: -66.879, lat: 10.480, zoom: 7 },
  'washington dc':   { lon: -77.036, lat: 38.907, zoom: 6 },
  'washington':      { lon: -77.036, lat: 38.907, zoom: 6 },
  'united states':   { lon: -98.583, lat: 39.833, zoom: 3 },
  'us':              { lon: -98.583, lat: 39.833, zoom: 3 },
  'ukraine':         { lon: 31.165, lat: 48.379, zoom: 4 },
  'russia':          { lon: 37.618, lat: 55.756, zoom: 3 },
  'israel':          { lon: 34.851, lat: 31.046, zoom: 6 },
  'gaza':            { lon: 34.465, lat: 31.501, zoom: 8 },
  'china':           { lon: 116.383, lat: 39.916, zoom: 3 },
  'taiwan':          { lon: 120.960, lat: 23.698, zoom: 7 },
  'north korea':     { lon: 125.727, lat: 39.019, zoom: 5 },
  'iran':            { lon: 51.389, lat: 35.689, zoom: 4 },
};

const MAPBOX_STYLE = 'mapbox/dark-v10';

async function fetchMap(geoLocation, outputPath) {
  if (!process.env.MAPBOX_TOKEN) {
    console.warn('[map] MAPBOX_TOKEN not set — skipping map fetch');
    return null;
  }

  const key = (geoLocation || '').toLowerCase().trim();
  const coords = GEO_GAZETTEER[key];
  if (!coords) {
    console.warn(`[map] No gazetteer entry for "${geoLocation}"`);
    return null;
  }

  const { lon, lat, zoom } = coords;
  // 1080x1920 map in @2x retina quality (actual pixels: 2160x3840 downsampled to 1080x1920)
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
