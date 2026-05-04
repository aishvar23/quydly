'use strict';

const fs = require('fs');
const axios = require('axios');

async function downloadEvidenceAsset(assetMeta, outputPath) {
  if (!assetMeta.file_url) return null;

  const response = await axios.get(assetMeta.file_url, {
    responseType: 'arraybuffer',
    timeout: 25000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'QuydlyEvidenceFirstPipeline/0.1',
    },
  });

  fs.writeFileSync(outputPath, response.data);

  return {
    kind: assetMeta.kind || 'photo',
    path: outputPath,
    sourceUrl: assetMeta.file_url,
    sourcePage: assetMeta.source_page,
    credit: assetMeta.credit,
    license: assetMeta.license,
  };
}

module.exports = {
  downloadEvidenceAsset,
};
