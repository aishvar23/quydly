'use strict';

const fs   = require('fs');
const path = require('path');
const { fetchMap } = require('../../lib/map-client');

// Evidence-driven asset resolver.
// No random stock search. Only: map images + motion graphics.
// Exact and contextual assets can be added later when available.

const GRAPHIC_ONLY_MODULES = new Set([
  'HookStrap', 'DossierCard', 'NumberCard', 'PersonCard',
  'ChargeCard', 'TimelineCard', 'PlatformCard', 'WhyItMattersCard', 'OutroLockup',
]);

async function run(ctx) {
  const { modulePlan, storyId, outputDir } = ctx;

  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  console.log(`[09-resolve-assets] Resolving assets for ${modulePlan.length} modules (evidence-driven)...`);

  const resolvedPlan = [];
  for (const module of modulePlan) {
    const resolved = await resolveModuleAsset(module, assetsDir);
    resolvedPlan.push(resolved);
    const assetDesc = resolved.mapSrc ? `map → ${path.basename(resolved.mapSrc)}` : 'motion_graphic';
    console.log(`  Module ${module.moduleId} [${module.moduleType}]: ${assetDesc}`);
  }

  return { modulePlan: resolvedPlan };
}

async function resolveModuleAsset(module, assetsDir) {
  if (GRAPHIC_ONLY_MODULES.has(module.moduleType)) {
    return { ...module, assetType: 'motion_graphic', mapSrc: null };
  }

  if (module.moduleType === 'MapCallout') {
    const locationKey = (module.locationLabel || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
    const mapPath     = path.join(assetsDir, `module-${module.moduleId}-map.png`);
    const fetched     = await fetchMap(locationKey, mapPath);
    return {
      ...module,
      mapSrc:    fetched ? mapPath : null,
      assetType: fetched ? 'map' : 'motion_graphic',
    };
  }

  return { ...module, assetType: 'motion_graphic', mapSrc: null };
}

module.exports = { run };
