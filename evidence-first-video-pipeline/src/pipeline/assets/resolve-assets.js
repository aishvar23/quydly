'use strict';

const fs = require('fs');
const path = require('path');
const { downloadEvidenceAsset } = require('./exact-asset-client');
const { resolveEntityImage } = require('./entity-image-client');
const { fetchMap } = require('./map-client');

async function resolveAssets(storyPackage, outputDir, { dryRun = false } = {}) {
  const assetsDir = path.join(outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const modules = [];
  for (const module of storyPackage.modules) {
    modules.push(await resolveModule(module, storyPackage.evidencePackage, assetsDir, dryRun));
  }

  return {
    ...storyPackage,
    modules,
  };
}

async function resolveModule(module, evidencePackage, assetsDir, dryRun) {
  if (dryRun) return withFallback(module, 'dry_run');
  if (!module.assetNeed) return withGraphic(module);

  if (module.assetNeed.geoLocation) {
    const mapAsset = await safeAttempt(() => fetchMap({
      geoLocation: module.assetNeed.geoLocation,
      outputPath: path.join(assetsDir, `module-${module.moduleId}-map.png`),
    }));
    return mapAsset ? withAsset(module, mapAsset, 'map') : withFallback(module, 'map_unavailable');
  }

  if (module.assetNeed.assetId) {
    const assetMeta = findEvidenceAsset(evidencePackage, module.assetNeed.assetId);
    if (!assetMeta) return withFallback(module, 'asset_not_in_evidence_package');

    const extension = extensionFor(assetMeta);
    const outputPath = path.join(assetsDir, `module-${module.moduleId}-${assetMeta.id}${extension}`);
    const asset = await safeAttempt(() => downloadEvidenceAsset(assetMeta, outputPath));
    return asset ? withAsset(module, asset, assetMeta.asset_class) : withFallback(module, 'asset_download_failed');
  }

  if (Array.isArray(module.assetNeed.people) && module.assetNeed.people.length) {
    const peopleAssets = (await Promise.all(module.assetNeed.people.slice(0, 2).map((personName) => (
      safeAttempt(() => resolveEntityImage({
        entityName: personName,
        outputPath: path.join(assetsDir, `module-${module.moduleId}-${safeName(personName)}`),
      }))
    )))).filter(Boolean);

    return peopleAssets.length
      ? withPeopleAsset(module, peopleAssets)
      : withFallback(module, 'person_image_unavailable');
  }

  if (module.assetNeed.personName) {
    const asset = await safeAttempt(() => resolveEntityImage({
      entityName: module.assetNeed.personName,
      outputPath: path.join(assetsDir, `module-${module.moduleId}-${safeName(module.assetNeed.personName)}`),
    }));
    return asset ? withAsset(module, asset, 'exact') : withFallback(module, 'person_image_unavailable');
  }

  return withGraphic(module);
}

function findEvidenceAsset(evidencePackage, assetId) {
  const pools = [
    evidencePackage.assets.exact_available || [],
    evidencePackage.assets.contextual_available || [],
  ];
  return pools.flat().find((asset) => asset.id === assetId) || null;
}

function extensionFor(assetMeta) {
  const source = `${assetMeta.file_url || ''} ${assetMeta.source_page || ''}`.toLowerCase();
  if (source.includes('.png')) return '.png';
  if (source.includes('.webp')) return '.webp';
  if (source.includes('.jpeg')) return '.jpg';
  if (source.includes('.jpg')) return '.jpg';
  return assetMeta.kind === 'photo' ? '.jpg' : '.asset';
}

function withAsset(module, asset, safetyClass) {
  return {
    ...module,
    asset: {
      kind: asset.kind,
      src: null,
      path: asset.path,
      sourceUrl: asset.sourceUrl,
      sourcePage: asset.sourcePage,
      credit: asset.credit,
      license: asset.license,
      safetyClass,
      fallbackReason: null,
    },
  };
}

function withPeopleAsset(module, peopleAssets) {
  const primary = peopleAssets[0];
  const resolvedPeople = peopleAssets.map((asset) => asset.subject).filter(Boolean);
  return {
    ...module,
    overlayText: resolvedPeople.length ? resolvedPeople.join(' / ') : module.overlayText,
    data: {
      ...(module.data || {}),
      name: resolvedPeople.length ? resolvedPeople.join(' / ') : module.data?.name,
      people: resolvedPeople.length ? resolvedPeople : module.data?.people,
      role: resolvedPeople.length > 1 ? 'named people in the story' : 'named person',
      label: resolvedPeople.length > 1 ? 'Exact person visuals' : 'Exact person visual',
    },
    asset: {
      kind: 'photo',
      src: null,
      path: primary.path,
      sourceUrl: primary.sourceUrl,
      sourcePage: primary.sourcePage,
      credit: primary.credit,
      license: primary.license,
      subject: primary.subject,
      safetyClass: 'exact',
      fallbackReason: null,
      people: peopleAssets.map((asset) => ({
        kind: asset.kind,
        src: null,
        path: asset.path,
        sourceUrl: asset.sourceUrl,
        sourcePage: asset.sourcePage,
        credit: asset.credit,
        license: asset.license,
        subject: asset.subject,
        safetyClass: 'exact',
        fallbackReason: null,
      })),
    },
  };
}

function withGraphic(module) {
  return {
    ...module,
    asset: {
      kind: 'graphic',
      src: null,
      path: null,
      sourceUrl: null,
      safetyClass: 'graphic',
      fallbackReason: null,
    },
  };
}

function withFallback(module, reason) {
  return {
    ...module,
    asset: {
      kind: module.assetClass || 'graphic',
      src: null,
      path: null,
      sourceUrl: null,
      safetyClass: module.assetClass || 'graphic',
      fallbackReason: reason,
    },
  };
}

async function safeAttempt(fn) {
  try {
    return await fn();
  } catch (error) {
    return null;
  }
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

module.exports = {
  resolveAssets,
};
