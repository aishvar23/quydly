'use strict';

const path = require('path');

// Load .env so secrets (ElevenLabs, Anthropic, Mapbox) flow into process.env.
// Load order: v2 local .env first, then sibling evidence-first/.env as fallback.
// dotenv does not overwrite existing process.env values, so v2 takes priority.
try {
  const dotenv = require('dotenv');
  // Load order matters: dotenv default does NOT override existing keys, so
  // earlier files win. v2/.env is highest precedence; video-pipeline/.env
  // is the canonical sibling for working credentials; evidence-first/.env
  // is the legacy fallback.
  dotenv.config(); // ./v2/.env if present
  dotenv.config({
    path: path.resolve(__dirname, '..', 'video-pipeline', '.env'),
  });
  dotenv.config({
    path: path.resolve(__dirname, '..', 'evidence-first-video-pipeline', '.env'),
  });
} catch (_) {
  // dotenv is optional — pipeline still runs against process.env directly.
}

require('./src/cli/generate-video').main();
