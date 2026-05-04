'use strict';

require('dotenv').config();

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { runPipeline } = require('../pipeline/orchestrator');

const argv = yargs(hideBin(process.argv))
  .usage('Usage: node index.js --story-file fixtures/sample-story.json [options]')
  .option('story-id', {
    type: 'string',
    describe: 'Supabase story id to load from the stories table',
  })
  .option('story-file', {
    type: 'string',
    describe: 'Local story JSON file for dry runs and fixtures',
  })
  .option('audience-geo', {
    type: 'string',
    default: 'global',
    describe: 'Target audience geography',
  })
  .option('mode', {
    type: 'string',
    choices: ['poc', 'production'],
    default: 'poc',
  })
  .option('skip-audit', {
    type: 'boolean',
    default: false,
  })
  .option('skip-render', {
    type: 'boolean',
    default: false,
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'No network assets and no Remotion render',
  })
  .option('use-ai', {
    type: 'boolean',
    default: false,
    describe: 'Use Anthropic for audit/script stages when ANTHROPIC_API_KEY is present',
  })
  .check((args) => {
    if (!args.storyId && !args.storyFile) {
      throw new Error('Provide either --story-id or --story-file');
    }
    return true;
  })
  .example('node index.js --story-file fixtures/sample-story.json --dry-run')
  .help()
  .argv;

runPipeline({
  storyId: argv.storyId,
  storyFile: argv.storyFile,
  audienceGeo: argv.audienceGeo,
  mode: argv.mode,
  skipAudit: argv.skipAudit,
  skipRender: argv.skipRender,
  dryRun: argv.dryRun,
  useAI: Boolean(argv.useAI || argv.useAi),
}).then((result) => {
  console.log(`\nDone: ${result.state}`);
  console.log(`Output: ${result.outputDir}`);
}).catch((error) => {
  console.error(`\nPipeline failed: ${error.message}`);
  process.exitCode = 1;
});
