'use strict';

const fs = require('fs');
const { fetchWithRetry } = require('./http');

// Hardcoded gazetteer keeps the POC offline-friendly and avoids a geocoding
// API call for known locations. Add new entries here as fixtures need them;
// later, fall back to Mapbox Geocoding API for unknown places.
const GAZETTEER = {
  // Cities
  'caracas':       { lon: -66.879, lat: 10.480, zoom: 8.6 },
  'manhattan':     { lon: -73.971, lat: 40.776, zoom: 11.4 },
  'new york':      { lon: -74.006, lat: 40.713, zoom: 9.4 },
  'washington':    { lon: -77.036, lat: 38.907, zoom: 10 },
  'london':        { lon: -0.118, lat: 51.509, zoom: 9.6 },
  'brussels':      { lon: 4.351, lat: 50.851, zoom: 10 },
  'moscow':        { lon: 37.618, lat: 55.751, zoom: 9 },
  'kyiv':          { lon: 30.524, lat: 50.450, zoom: 9.4 },
  'beijing':       { lon: 116.407, lat: 39.904, zoom: 9 },
  'tokyo':         { lon: 139.692, lat: 35.690, zoom: 9 },
  'tel aviv':      { lon: 34.781, lat: 32.085, zoom: 10 },
  'tehran':        { lon: 51.389, lat: 35.689, zoom: 9.4 },
  'seoul':         { lon: 126.978, lat: 37.566, zoom: 9.4 },
  'reykjavik':     { lon: -21.943, lat: 64.147, zoom: 10 },
  'singapore':     { lon: 103.820, lat: 1.352, zoom: 10 },
  'los angeles':   { lon: -118.243, lat: 34.052, zoom: 9.4 },
  // Countries / regions
  'venezuela':     { lon: -66.879, lat: 8.0, zoom: 4.6 },
  'united states': { lon: -98.583, lat: 39.833, zoom: 3.0 },
  'russia':        { lon: 64.0, lat: 60.0, zoom: 2.6 },
  'ukraine':       { lon: 31.165, lat: 48.379, zoom: 4.8 },
  'european union':{ lon: 15.0, lat: 51.0, zoom: 3.2 },
  'china':         { lon: 104.195, lat: 35.861, zoom: 3.0 },
  'india':         { lon: 78.961, lat: 20.594, zoom: 3.6 },
  'iran':          { lon: 53.688, lat: 32.428, zoom: 4.6 },
  'israel':        { lon: 34.852, lat: 31.046, zoom: 6.6 },
  'taiwan':        { lon: 120.961, lat: 23.698, zoom: 6.0 },
  'north korea':   { lon: 127.510, lat: 40.339, zoom: 5.4 },
  'south korea':   { lon: 127.766, lat: 35.908, zoom: 5.8 },
  'iceland':       { lon: -19.021, lat: 64.963, zoom: 5.4 },
  'sumatra':       { lon: 101.343, lat: -0.789, zoom: 4.8 },
  'indonesia':     { lon: 113.921, lat: -0.789, zoom: 3.6 },
};

const DEFAULT_STYLE = 'dark-v11';
const DEFAULT_WIDTH = 540;   // @2x → 1080 native
const DEFAULT_HEIGHT = 960;  // @2x → 1920 native, full bleed

function hasMapbox() {
  return Boolean(process.env.MAPBOX_TOKEN);
}

function lookupLocation(name) {
  if (!name) return null;
  return GAZETTEER[String(name).trim().toLowerCase()] || null;
}

// Process-lifetime cache for forward-geocode results so a batch run that
// hits the same place ten times only pays the API cost once.
const geocodeCache = new Map();

// Mapbox Geocoding v6 forward lookup. Returns { lon, lat, zoom } or null.
// Zoom is heuristic: city/locality → 9.4, region/country → 4.6.
async function forwardGeocode(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  if (!hasMapbox()) return null;
  const token = process.env.MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(name)}&limit=1&access_token=${token}`;
  let response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    console.warn(`[mapbox-geocode] Network error for "${name}": ${error.message}`);
    geocodeCache.set(key, null);
    return null;
  }
  if (!response.ok) {
    console.warn(`[mapbox-geocode] HTTP ${response.status} for "${name}"`);
    geocodeCache.set(key, null);
    return null;
  }
  const data = await response.json().catch(() => null);
  const feature = data?.features?.[0];
  if (!feature?.geometry?.coordinates) {
    geocodeCache.set(key, null);
    return null;
  }
  const [lon, lat] = feature.geometry.coordinates;
  const featureType = feature?.properties?.feature_type || feature?.place_type?.[0] || '';
  const zoom = /country|region|district|state/i.test(featureType) ? 4.6 : 9.4;
  const coords = { lon, lat, zoom, source: 'geocoded' };
  geocodeCache.set(key, coords);
  return coords;
}

// Returns either { ok: true, ...meta } on success or
// { ok: false, reason, hint } on every distinct failure path. Callers use
// the reason for grouping/counting and the hint for human debugging.
async function fetchMap({ location, outputPath, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, zoomOverride = null, style = DEFAULT_STYLE }) {
  if (!hasMapbox()) {
    return { ok: false, reason: 'mapbox_token_missing', hint: 'MAPBOX_TOKEN env var not set' };
  }
  let coords = lookupLocation(location);
  // MAPBOX_AUTO_GEOCODE=true falls through to the Mapbox geocoding API for
  // off-gazetteer places. Off by default to avoid surprise API spend; opt-in
  // for batch runs against real-world data (Supabase stories, etc.).
  if (!coords && String(process.env.MAPBOX_AUTO_GEOCODE).toLowerCase() === 'true') {
    coords = await forwardGeocode(location);
  }
  if (!coords) {
    return {
      ok: false,
      reason: 'off_gazetteer',
      hint: `"${location}" not in mapbox.js GAZETTEER — add coordinates or set MAPBOX_AUTO_GEOCODE=true`,
    };
  }

  const token = process.env.MAPBOX_TOKEN;
  const zoom = zoomOverride ?? coords.zoom;
  const url = `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${coords.lon},${coords.lat},${zoom},0/${width}x${height}@2x?access_token=${token}&attribution=false&logo=false`;

  let response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    console.warn(`[mapbox] Network error for ${location} (after retries): ${error.message}`);
    return {
      ok: false,
      reason: 'mapbox_network',
      hint: `Network error after retries: ${error.message}`,
    };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn(`[mapbox] HTTP ${response.status} for ${location}: ${body.slice(0, 200)}`);
    return {
      ok: false,
      reason: `mapbox_http_${response.status}`,
      hint: `Mapbox returned HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return {
    ok: true,
    path: outputPath,
    sourceUrl: url.replace(/access_token=[^&]+/, 'access_token=REDACTED'),
    credit: 'Map: Mapbox + OpenStreetMap',
    license: 'Mapbox Static Images API terms',
    location,
    coords,
  };
}

module.exports = {
  hasMapbox,
  lookupLocation,
  forwardGeocode,
  fetchMap,
  GAZETTEER,
};
