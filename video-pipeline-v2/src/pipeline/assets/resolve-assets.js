'use strict';

const fs = require('fs');
const path = require('path');
const { fetchMap, hasMapbox } = require('../../integrations/mapbox');
const { fetchEntityImage } = require('../../integrations/wikimedia');

// Generic asset resolver. Walks every module's assetNeed and fills in the
// asset slot with a downloaded file path + provenance. Failures fall back to
// graphic with a fallbackReason; the renderer's null-guards handle the rest.

async function resolveAssets(storyPackage, outputDir) {
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const modules = [];
  for (const module of storyPackage.modules) {
    modules.push(await resolveModule(module, assetsDir));
  }

  const summary = summarize(modules);
  return {
    ...storyPackage,
    modules,
    asset_summary: summary,
  };
}

async function resolveModule(module, assetsDir) {
  if (!module.assetNeed) return module;

  if (module.assetNeed.kind === 'map' || module.assetNeed.geoLocation) {
    const location = module.assetNeed.geoLocation || module.assetNeed.location;
    return resolveMap(module, location, assetsDir);
  }

  if (module.assetNeed.kind === 'entity_photo') {
    return resolveEntityPhoto(module, module.assetNeed.entityName, assetsDir);
  }

  return module;
}

async function resolveEntityPhoto(module, entityName, assetsDir) {
  if (!entityName) {
    return withFallback(module, 'graphic', 'entity_name_missing', 'Module assetNeed had no entityName');
  }
  // Wikipedia is the source: real photos of real entities, attributable.
  // Failures fall back to typographic-only render — module still ships.
  const result = await fetchEntityImage(entityName, 'person', { outputDir: path.dirname(assetsDir) });
  if (!result.ok) {
    return withFallback(module, 'graphic', result.reason, result.hint);
  }
  return {
    ...module,
    asset: {
      kind: 'entity_photo',
      src: null, // populated by prepare-render-props
      path: result.path,
      sourceUrl: result.sourceUrl,
      credit: result.credit,
      license: result.license,
      attribution: result.attribution,
      entityName: result.entityName,
      safetyClass: 'entity_photo',
      fallbackReason: null,
      fallbackHint: null,
    },
  };
}

async function resolveMap(module, location, assetsDir) {
  if (!location) {
    return withFallback(module, 'map', 'map_location_missing', 'Module assetNeed had no geoLocation');
  }

  // Try Wikipedia for a place photo first — a real photo of the location
  // (Strait of Hormuz, Reykjavik, Sumatra) is more relatable than a vector
  // map tile. Falls through to Mapbox when Wikipedia 404s, mismatches title,
  // or has no thumbnail.
  const photo = await fetchEntityImage(location, 'place', { outputDir: path.dirname(assetsDir) });
  if (photo.ok) {
    return {
      ...module,
      asset: {
        kind: 'place_photo',
        src: null,
        path: photo.path,
        sourceUrl: photo.sourceUrl,
        credit: photo.credit,
        license: photo.license,
        attribution: photo.attribution,
        entityName: photo.entityName,
        safetyClass: 'place_photo',
        fallbackReason: null,
        fallbackHint: null,
      },
    };
  }

  // Wikipedia didn't deliver — fall back to Mapbox.
  if (!hasMapbox()) {
    return withFallback(module, 'map', 'mapbox_token_missing', 'MAPBOX_TOKEN env var not set');
  }
  const filename = `module-${module.moduleId}-map.png`;
  const outputPath = path.join(assetsDir, filename);
  const result = await fetchMap({ location, outputPath });
  if (!result.ok) {
    return withFallback(module, 'map', result.reason, result.hint);
  }

  return {
    ...module,
    asset: {
      kind: 'map',
      src: null, // populated by prepare-render-props after copy to public/jobs/
      path: result.path,
      sourceUrl: result.sourceUrl,
      credit: result.credit,
      license: result.license,
      safetyClass: 'map',
      fallbackReason: null,
      fallbackHint: null,
    },
  };
}

function withFallback(module, kind, reason, hint) {
  return {
    ...module,
    asset: {
      kind,
      src: null,
      path: null,
      sourceUrl: null,
      credit: null,
      license: null,
      safetyClass: kind,
      fallbackReason: reason,
      fallbackHint: hint || null,
    },
  };
}

function summarize(modules) {
  const counts = {};
  for (const module of modules) {
    const kind = module.asset?.kind || 'graphic';
    counts[kind] = (counts[kind] || 0) + 1;
    if (module.asset?.fallbackReason) {
      counts[`fallback:${module.asset.fallbackReason}`] = (counts[`fallback:${module.asset.fallbackReason}`] || 0) + 1;
    }
  }
  return counts;
}

module.exports = {
  resolveAssets,
};
