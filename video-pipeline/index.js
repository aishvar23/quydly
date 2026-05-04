'use strict';

require('dotenv').config();

const yargs = require('yargs');
const { runPipeline } = require('./pipeline/orchestrator');

const argv = yargs
  .usage('Usage: node index.js --story-id <n> [options]')
  .option('story-id',     { type: 'number',  required: true,  describe: 'Story ID to render' })
  .option('audience-geo', { type: 'string',  default: 'global', describe: 'Target audience geography' })
  .option('mode',         { type: 'string',  choices: ['poc', 'production'], default: 'poc', describe: 'Run mode' })
  .option('skip-audit',   { type: 'boolean', default: false, describe: 'Skip video candidate audit (poc only)' })
  .example('node index.js --story-id 155 --audience-geo global --mode poc')
  .example('node index.js --story-id 155 --mode poc --skip-audit')
  .argv;

runPipeline({
  storyId:     argv['story-id'],
  audienceGeo: argv['audience-geo'],
  mode:        argv.mode,
  skipAudit:   argv['skip-audit'],
}).catch(err => {
  console.error('Unexpected pipeline error:', err.message);
  process.exit(1);
});
