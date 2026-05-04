'use strict';

const fs   = require('fs');
const path = require('path');
const { JOB_STATES } = require('./job-states');

const stages = [
  { state: JOB_STATES.STORY_VALIDATED,      module: require('./stages/01-story-intake') },
  { state: JOB_STATES.STORY_VALIDATED,      module: require('./stages/02-video-audit') },
  { state: JOB_STATES.STORY_UNDERSTOOD,     module: require('./stages/03-understand-story') },
  { state: JOB_STATES.EVIDENCE_PACKAGED,    module: require('./stages/04-generate-evidence-package') },
  { state: JOB_STATES.SCRIPT_READY,         module: require('./stages/05-generate-script') },
  { state: JOB_STATES.VOICE_READY,          module: require('./stages/06-generate-voice') },
  { state: JOB_STATES.MODULE_PLAN_READY,    module: require('./stages/07-plan-modules') },
  { state: JOB_STATES.BEATS_ALIGNED,        module: require('./stages/08-beat-alignment') },
  { state: JOB_STATES.ASSETS_READY,         module: require('./stages/09-resolve-assets') },
  { state: JOB_STATES.SUBTITLES_READY,      module: require('./stages/10-subtitle-generation') },
  { state: JOB_STATES.RENDER_READY,         module: require('./stages/11-remotion-render') },
  { state: JOB_STATES.EXPORTED,             module: require('./stages/12-ffmpeg-export') },
  { state: JOB_STATES.METADATA_READY,       module: require('./stages/13-metadata-generation') },
];

async function runPipeline({ storyId, audienceGeo, mode, skipAudit }) {
  const storyBase = path.resolve(__dirname, `../output/story-${storyId}`);
  const version   = nextVersion(storyBase);
  const outputDir = path.join(storyBase, version);
  fs.mkdirSync(outputDir, { recursive: true });

  let ctx = { storyId, audienceGeo, mode, skipAudit, outputDir, version };
  let jobState = JOB_STATES.QUEUED;

  console.log(`\n=== Quydly Evidence-First Video Pipeline ===`);
  console.log(`Story: ${storyId} | Geo: ${audienceGeo} | Mode: ${mode} | Version: ${version}`);
  console.log(`Output: ${outputDir}\n`);

  for (const stage of stages) {
    try {
      const result = await stage.module.run(ctx);

      if (result && result.rejected) {
        jobState = JOB_STATES.VIDEO_CANDIDATE_REJECTED;
        console.log(`\n[PIPELINE] Story rejected at video audit: ${result.reason}`);
        writeLog(outputDir, 'video-rejected.json', { reason: result.reason });
        return;
      }

      ctx      = { ...ctx, ...result };
      jobState = stage.state;
    } catch (err) {
      jobState = JOB_STATES.FAILED;
      console.error(`\n[PIPELINE FAILED] at state ${jobState}`);
      console.error(err.message);
      writeLog(outputDir, 'pipeline-failure.json', { failed_at: stage.state, error: err.message, stack: err.stack });
      process.exit(1);
    }
  }

  jobState = JOB_STATES.COMPLETE;
  console.log('\n=== Pipeline complete ===');
  console.log(`State: ${jobState} | Pipeline: evidence-first-v1`);
  console.log('Output files:');
  listOutputFiles(outputDir);
}

function writeLog(outputDir, filename, data) {
  fs.writeFileSync(
    path.join(outputDir, filename),
    JSON.stringify({ ...data, timestamp: new Date().toISOString() }, null, 2)
  );
}

function nextVersion(storyBase) {
  if (!fs.existsSync(storyBase)) return 'v1';
  const existing = fs.readdirSync(storyBase)
    .filter(f => /^v\d+$/.test(f) && fs.statSync(path.join(storyBase, f)).isDirectory())
    .map(f => parseInt(f.slice(1), 10))
    .sort((a, b) => a - b);
  const last = existing[existing.length - 1] ?? 0;
  return `v${last + 1}`;
}

function listOutputFiles(dir) {
  const files = fs.readdirSync(dir).filter(f => !fs.statSync(path.join(dir, f)).isDirectory());
  files.forEach(f => console.log(`  ${f}`));
}

module.exports = { runPipeline };
