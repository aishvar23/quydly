'use strict';

const fs = require('fs');
const path = require('path');
const { OUTPUT_ROOT } = require('../shared/config');
const { JOB_STATES } = require('./job-states');
const { loadStory } = require('./selectors/select-video-candidates');
const { auditVideoCandidate } = require('./audit/video-candidate-audit');
const { generateScript } = require('./script/generate-script');
const { generateVoice } = require('./voice/generate-voice');
const { planScenes } = require('./scenes/plan-scenes');
const { resolveAssets } = require('./assets/resolve-assets');
const { generateSubtitles } = require('./subtitles/generate-srt');
const { renderVideo } = require('./render/render-video');
const { exportVideo } = require('./render/export-video');
const { generateMetadata } = require('./metadata/generate-metadata');

async function runPipeline(options) {
  const ctx = normalizeOptions(options);
  const outputDir = createOutputDir(ctx);
  let state = JOB_STATES.QUEUED;

  try {
    logState(state, 'Queued animated video job');

    const story = await loadStory(ctx);
    state = JOB_STATES.STORY_VALIDATED;
    logState(state, story.headline);

    const audit = await auditVideoCandidate(story, ctx);
    if (audit.rejected) {
      state = JOB_STATES.VIDEO_CANDIDATE_REJECTED;
      writeJson(outputDir, 'video-rejected.json', { state, audit });
      logState(state, audit.video_skip_reason);
      return { state, outputDir, story, audit };
    }

    state = JOB_STATES.SCRIPT_GENERATING;
    logState(state, 'Generating spoken script and editorial overlays');
    const script = await generateScript(story, audit, ctx);
    writeJson(outputDir, 'script.json', script);
    state = JOB_STATES.SCRIPT_READY;
    logState(state, `${countWords(script.full_script)} words`);

    state = JOB_STATES.VOICE_GENERATING;
    logState(state, 'Generating or estimating narration timing');
    const voice = await generateVoice(script, outputDir);
    state = JOB_STATES.VOICE_READY;
    logState(state, voice.isTimingOnly ? 'Timing-only narration' : 'Narration audio ready');

    const planned = planScenes({
      story,
      script,
      voice,
      audienceGeo: ctx.audienceGeo,
    });
    state = JOB_STATES.SCENE_PLAN_READY;
    logState(state, `${planned.scenes.length} controlled scenes`);

    let storyPackage = {
      story,
      audit,
      script,
      voice,
      scenes: planned.scenes,
      totalDurationSec: planned.totalDurationSec,
      audienceGeo: ctx.audienceGeo,
      mode: ctx.mode,
      version: path.basename(outputDir),
      outputDir,
    };

    state = JOB_STATES.ASSETS_RESOLVING;
    logState(state, 'Resolving controlled assets and safe fallbacks');
    storyPackage = await resolveAssets(storyPackage, outputDir, ctx);
    state = JOB_STATES.ASSETS_READY;
    logState(state, summarizeAssets(storyPackage.scenes));

    storyPackage = generateSubtitles(storyPackage, outputDir);
    state = JOB_STATES.SUBTITLES_READY;
    logState(state, `${storyPackage.subtitles.length} cues`);

    writeJson(outputDir, 'story-package.json', storyPackage);

    state = JOB_STATES.RENDERING;
    logState(state, ctx.skipRender ? 'Render skipped' : 'Rendering Remotion composition');
    storyPackage = renderVideo(storyPackage, outputDir, ctx);
    state = ctx.skipRender ? JOB_STATES.REVIEW_REQUIRED : JOB_STATES.RENDER_READY;
    logState(state, storyPackage.renderVideoPath || 'render-props.json');

    state = JOB_STATES.EXPORTING;
    logState(state, ctx.skipRender ? 'Export skipped' : 'Encoding platform MP4');
    storyPackage = await exportVideo(storyPackage, outputDir, ctx);
    state = storyPackage.exportPath ? JOB_STATES.READY_TO_PUBLISH : JOB_STATES.REVIEW_REQUIRED;
    logState(state, storyPackage.exportPath || 'dry run package ready');

    storyPackage = generateMetadata(storyPackage, outputDir);
    writeJson(outputDir, 'story-package-final.json', storyPackage);

    return {
      state,
      outputDir,
      storyPackage,
    };
  } catch (error) {
    state = JOB_STATES.FAILED;
    writeJson(outputDir, 'pipeline-failure.json', {
      state,
      error: error.message,
      stack: error.stack,
      failed_at: new Date().toISOString(),
    });
    throw error;
  }
}

function normalizeOptions(options) {
  return {
    storyId: options.storyId,
    storyFile: options.storyFile,
    audienceGeo: options.audienceGeo || 'global',
    mode: options.mode || 'poc',
    skipAudit: Boolean(options.skipAudit),
    skipRender: Boolean(options.skipRender || options.dryRun),
    dryRun: Boolean(options.dryRun),
    useAI: Boolean(options.useAI),
    outputRoot: options.outputRoot || OUTPUT_ROOT,
  };
}

function createOutputDir(ctx) {
  const storyKey = ctx.storyId || path.basename(ctx.storyFile || 'story', path.extname(ctx.storyFile || ''));
  const base = path.resolve(ctx.outputRoot, `story-${safeName(storyKey)}`);
  fs.mkdirSync(base, { recursive: true });
  const version = nextVersion(base);
  const outputDir = path.join(base, version);
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function nextVersion(base) {
  const versions = fs.readdirSync(base)
    .filter((name) => /^v\d+$/.test(name))
    .map((name) => Number(name.slice(1)))
    .sort((a, b) => a - b);
  return `v${(versions[versions.length - 1] || 0) + 1}`;
}

function writeJson(dir, filename, value) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(value, null, 2), 'utf8');
}

function logState(state, message) {
  console.log(`[${state}] ${message}`);
}

function countWords(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function summarizeAssets(scenes) {
  const counts = scenes.reduce((summary, scene) => {
    const kind = scene.asset?.kind || 'unknown';
    summary[kind] = (summary[kind] || 0) + 1;
    return summary;
  }, {});
  return Object.entries(counts).map(([kind, count]) => `${kind}:${count}`).join(', ');
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-');
}

module.exports = {
  runPipeline,
};
