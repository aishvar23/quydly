'use strict';

const fs = require('fs');
const path = require('path');
const { OUTPUT_ROOT } = require('../shared/config');
const { JOB_STATES } = require('./job-states');
const { loadStory } = require('./selectors/select-video-candidates');
const { auditVideoCandidate } = require('./audit/video-candidate-audit');
const { understandStory } = require('./understanding/understand-story');
const { generateEvidencePackage } = require('./evidence/generate-evidence-package');
const { generateScript } = require('./script/generate-script');
const { generateVoice } = require('./voice/generate-voice');
const { planModules } = require('./modules/plan-modules');
const { resolveAssets } = require('./assets/resolve-assets');
const { generateSubtitles } = require('./subtitles/generate-srt');
const { generateBackgroundMusic } = require('./music/generate-background-music');
const { renderVideo } = require('./render/render-video');
const { exportVideo } = require('./render/export-video');
const { generateMetadata } = require('./metadata/generate-metadata');

async function runPipeline(options) {
  const ctx = normalizeOptions(options);
  let outputDir = null;
  let state = JOB_STATES.QUEUED;

  try {
    logState(state, 'Queued evidence-first video job');

    const story = await loadStory(ctx);
    outputDir = createOutputDir(ctx, story);
    state = JOB_STATES.STORY_VALIDATED;
    logState(state, story.headline);

    const audit = await auditVideoCandidate(story, ctx);
    if (audit.rejected) {
      state = JOB_STATES.VIDEO_CANDIDATE_REJECTED;
      writeJson(outputDir, 'video-rejected.json', { state, audit });
      logState(state, audit.video_skip_reason);
      return { state, outputDir, story, audit };
    }

    const understanding = understandStory(story);
    state = JOB_STATES.STORY_UNDERSTOOD;
    writeJson(outputDir, 'story-understanding.json', understanding);
    logState(state, summarizeUnderstanding(understanding));

    const evidencePackage = generateEvidencePackage(story, understanding, audit);
    state = JOB_STATES.EVIDENCE_PACKAGED;
    writeJson(outputDir, 'evidence-package.json', evidencePackage);
    logState(state, summarizeEvidence(evidencePackage));

    const script = await generateScript(story, audit, ctx, evidencePackage);
    writeJson(outputDir, 'script.json', script);
    state = JOB_STATES.SCRIPT_READY;
    logState(state, `${countWords(script.full_script)} words`);

    logState('VOICE_GENERATING', 'Generating or estimating narration timing');
    const voice = await generateVoice(script, outputDir);
    state = JOB_STATES.VOICE_READY;
    logState(state, voice.isTimingOnly ? 'Timing-only narration' : 'Narration audio ready');

    const planned = planModules({
      story,
      evidencePackage,
      script,
      voice,
      audienceGeo: ctx.audienceGeo,
    });
    state = JOB_STATES.MODULE_PLAN_READY;
    writeJson(outputDir, 'module-plan.json', planned);
    logState(state, `${planned.modules.length} evidence modules`);

    let storyPackage = {
      story,
      audit,
      understanding,
      evidencePackage,
      script,
      voice,
      modules: planned.modules,
      totalDurationSec: planned.totalDurationSec,
      audienceGeo: ctx.audienceGeo,
      mode: ctx.mode,
      version: path.basename(outputDir),
      outputDir,
    };

    logState('ASSETS_RESOLVING', 'Resolving exact/contextual assets and graphic fallbacks');
    storyPackage = await resolveAssets(storyPackage, outputDir, ctx);
    state = JOB_STATES.ASSETS_READY;
    logState(state, summarizeAssets(storyPackage.modules));

    storyPackage = generateSubtitles(storyPackage, outputDir);
    logState('SUBTITLES_READY', `${storyPackage.subtitles.length} cues`);

    storyPackage = generateBackgroundMusic(storyPackage, outputDir);
    logState('MUSIC_READY', `${storyPackage.music.style} at mix ${storyPackage.music.mixVolume}`);

    writeJson(outputDir, 'story-package.json', storyPackage);

    state = JOB_STATES.RENDERING;
    logState(state, ctx.skipRender ? 'Render skipped' : 'Rendering Remotion evidence modules');
    storyPackage = renderVideo(storyPackage, outputDir, ctx);
    state = ctx.skipRender ? JOB_STATES.READY_TO_REVIEW : JOB_STATES.RENDER_READY;
    logState(state, storyPackage.renderVideoPath || 'render-props.json');

    logState('EXPORTING', ctx.skipRender ? 'Export skipped' : 'Encoding platform MP4');
    storyPackage = await exportVideo(storyPackage, outputDir, ctx);
    state = storyPackage.exportPath ? JOB_STATES.READY_TO_PUBLISH : JOB_STATES.READY_TO_REVIEW;
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
    if (!outputDir) outputDir = createOutputDir(ctx);
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
    outputVersion: options.outputVersion || null,
  };
}

function createOutputDir(ctx, story = null) {
  const storyKey = story?.id || ctx.storyId || path.basename(ctx.storyFile || 'story', path.extname(ctx.storyFile || ''));
  const base = path.resolve(ctx.outputRoot, `story-${safeName(storyKey)}`);
  fs.mkdirSync(base, { recursive: true });
  const version = ctx.outputVersion ? safeName(ctx.outputVersion) : nextVersion(base);
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

function summarizeAssets(modules) {
  const counts = modules.reduce((summary, module) => {
    const kind = module.asset?.kind || module.assetClass || 'graphic';
    summary[kind] = (summary[kind] || 0) + 1;
    return summary;
  }, {});
  return Object.entries(counts).map(([kind, count]) => `${kind}:${count}`).join(', ');
}

function summarizeUnderstanding(understanding) {
  const people = (understanding.entities.people || []).map((person) => person.name).join(', ');
  const money = (understanding.numbers.money || []).map((item) => item.display).join(', ');
  return [people, money].filter(Boolean).join(' | ');
}

function summarizeEvidence(evidencePackage) {
  return [
    `exact:${evidencePackage.assets.exact_available.length}`,
    `contextual:${evidencePackage.assets.contextual_available.length}`,
    `graphics:${evidencePackage.assets.graphics_needed.length}`,
  ].join(', ');
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-');
}

module.exports = {
  runPipeline,
};
