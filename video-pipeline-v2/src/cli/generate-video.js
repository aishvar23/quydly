#!/usr/bin/env node
'use strict';

const path = require('path');
const { runPipeline } = require('../pipeline/orchestrator');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args['story-id'] && !args['story-file'])) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (!preflightEnv(args)) {
    process.exit(1);
  }

  try {
    const result = await runPipeline({
      storyId: args['story-id'],
      storyFile: args['story-file'],
      audienceGeo: args['audience-geo'] || 'global',
      mode: args.mode || 'poc',
      skipAudit: Boolean(args['skip-audit']),
      skipRender: Boolean(args['skip-render']),
      useAI: Boolean(args['use-ai']),
      allowFallbacks: Boolean(args['allow-fallbacks']),
      dryRunFallbacks: Boolean(args['dry-run-fallbacks']),
      youtube: Boolean(args.youtube),
      voiceId: typeof args.voice === 'string' ? args.voice : null,
    });

    console.log('');
    console.log(`Done. State: ${result.state}`);
    console.log(`Output: ${path.relative(process.cwd(), result.outputDir)}`);
  } catch (error) {
    console.error('');
    console.error(`Pipeline failed: ${error.message}`);
    process.exit(1);
  }
}

function preflightEnv(args) {
  // Required: --use-ai needs ANTHROPIC_API_KEY (no graceful path).
  if (args['use-ai'] && !process.env.ANTHROPIC_API_KEY) {
    console.error('error: --use-ai requires ANTHROPIC_API_KEY in .env or process.env');
    return false;
  }

  // Optional integrations. Warn — pipeline degrades gracefully on missing keys.
  const skipRender = Boolean(args['skip-render']);
  if (!process.env.ELEVENLABS_API_KEY) {
    console.warn('[preflight] ELEVENLABS_API_KEY missing — voice will use synthetic timing only.');
  }
  if (!process.env.MAPBOX_TOKEN && !skipRender) {
    console.warn('[preflight] MAPBOX_TOKEN missing — map modules will fall back to graphic-only.');
  }
  return true;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node src/cli/generate-video.js --story-file fixtures/sample-story-155.json
  node src/cli/generate-video.js --story-id 155 [--mode production] [--skip-audit]

Options:
  --story-file PATH      Load story from a JSON file (relative or absolute)
  --story-id ID          Load fixtures/sample-story-<ID>.json
  --audience-geo GEO     Audience geo tag (default: global)
  --mode poc|production  Validation/audit strictness (default: poc).
                         In production, the pipeline FAILS if any fallback fired
                         (synthetic voice, missing asset, AI script error).
  --allow-fallbacks      In production mode, render anyway even with fallbacks.
                         Use only when degraded output is acceptable.
  --dry-run-fallbacks    Predict fallbacks without paying for TTS or render.
                         Forces synthetic voice (skips ElevenLabs API), runs
                         through asset resolution, prints the report, and exits.
  --skip-audit           Skip the candidate audit (debug only)
  --skip-render          Run all stages, write artifacts, but skip the MP4 render
  --use-ai               Generate script via Claude (falls back to deterministic on error)
  --youtube              After render, also produce a YouTube publish package:
                           youtube/title.txt, description.md, sources.md,
                           thumbnail.png (1280x720), thumbnail-props.json
  --voice <id>           Override ElevenLabs voice ID for this run.
                         Defaults: ELEVENLABS_VOICE_ID env, then "Sarah" (EXAVITQu4vr4xnSDxMaL).
                         Try Brian (nPczCjzI2devNBz1zQrb) for warmer news-anchor read.
                         Voice settings (stability/style/etc.) live in env:
                         ELEVENLABS_STABILITY=0.45  ELEVENLABS_STYLE=0.40
                         ELEVENLABS_SIMILARITY_BOOST=0.78  ELEVENLABS_USE_SPEAKER_BOOST=true
  --help                 Show this message
`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
