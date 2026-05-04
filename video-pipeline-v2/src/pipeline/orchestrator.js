'use strict';

// ─── storyPackage stage transitions ──────────────────────────────────────────
// The pipeline's storyPackage object accumulates fields across stages. This
// is the canonical map of who adds what. expectFields() catches accidental
// drops at runtime; the comments below are the documented contract.
//
//   STORY_VALIDATED      + story
//   audit (separate var)
//   STORY_UNDERSTOOD     + understanding (story_type, entities, numbers, legal,
//                                          timeline_events, visualizable_concepts,
//                                          why_it_matters, metadata, verbatim_quote)
//   EVIDENCE_PACKAGED    + evidencePackage (audit, entities, numbers, legal,
//                                            timeline_events, visual_concepts,
//                                            source_documents, assets, safety_notes,
//                                            forbidden_visuals, verbatim_quote, metadata)
//   SCRIPT_READY         + script (hook, body, close, full_script, segments,
//                                   title_variants, thumbnail_copy,
//                                   overlay_phrases, generation_source,
//                                   ai_attempted, ai_error)
//   VOICE_READY          + voice (audioPath, alignment, totalDurationSec, isTimingOnly)
//   MODULE_PLAN_READY    + modules + totalDurationSec
//   ASSETS_READY         (mutates modules[*].asset) + asset_summary
//   SUBTITLES_READY      + subtitles + srtPath + subtitleCuesPath
//   RENDERING            + render
//   RENDER_READY         + renderVideoPath
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { OUTPUT_ROOT } = require('../shared/config');
const { JOB_STATES } = require('./job-states');
const { loadStory } = require('./selectors/load-story');
const { auditVideoCandidate } = require('./audit/video-candidate-audit');
const { understandStory } = require('./understand/understand-story');
const { generateEvidencePackage } = require('./evidence/evidence-package');
const { generateScript } = require('./script/generate-script');
const { generateVoice } = require('./voice/generate-voice');
const { planModules } = require('./modules/plan-modules');
const { generateSubtitles } = require('./subtitles/generate-srt');
const { resolveAssets } = require('./assets/resolve-assets');
const { renderVideo } = require('./render/render-video');
const { writeFallbackReport, summarize: summarizeFallbacks } = require('./audit/fallback-report');

async function runPipeline(options = {}) {
  const ctx = normalizeOptions(options);
  let outputDir = null;
  let state = JOB_STATES.QUEUED;

  try {
    log(state, 'Queued evidence-first video job (v2 generic)');

    const story = loadStory(ctx);
    outputDir = createOutputDir(ctx, story);
    writeJson(outputDir, 'story.json', story);
    state = JOB_STATES.STORY_VALIDATED;
    log(state, story.headline);

    const audit = auditVideoCandidate(story, ctx);
    writeJson(outputDir, 'audit.json', audit);
    if (audit.rejected) {
      state = JOB_STATES.VIDEO_CANDIDATE_REJECTED;
      log(state, audit.video_skip_reason);
      return { state, outputDir, story, audit };
    }

    const understanding = understandStory(story, audit);
    writeJson(outputDir, 'story-understanding.json', understanding);
    state = JOB_STATES.STORY_UNDERSTOOD;
    log(state, summarizeUnderstanding(understanding));

    const evidencePackage = generateEvidencePackage(story, understanding, audit);
    writeJson(outputDir, 'evidence-package.json', evidencePackage);
    state = JOB_STATES.EVIDENCE_PACKAGED;
    log(state, summarizeEvidence(evidencePackage));

    const script = await generateScript(evidencePackage, audit, { useAI: ctx.useAI });
    writeJson(outputDir, 'script.json', script);
    state = JOB_STATES.SCRIPT_READY;
    const sourceLabel = script.generation_source || 'deterministic';
    const aiNote = script.ai_attempted && script.ai_error ? ` (AI fallback: ${script.ai_error})` : '';
    log(state, `${countWords(script.full_script)} words from ${sourceLabel}${aiNote}`);

    const voice = await generateVoice(script, outputDir, {
      forceSynthetic: ctx.dryRunFallbacks,
      voiceId: ctx.voiceId,
    });
    writeJson(outputDir, 'voice.json', voice);
    state = JOB_STATES.VOICE_READY;
    const voiceLabel = voice.isTimingOnly
      ? (voice.forcedSynthetic ? 'forced synthetic (dry-run)' : 'synthetic timing (no TTS)')
      : 'real TTS';
    log(state, `${voice.totalDurationSec.toFixed(2)}s ${voiceLabel}`);

    const modulePlan = planModules({ story, evidencePackage, script, voice });
    writeJson(outputDir, 'module-plan.json', modulePlan);
    state = JOB_STATES.MODULE_PLAN_READY;
    log(state, `${modulePlan.modules.length} modules, ${modulePlan.totalDurationSec.toFixed(2)}s total`);

    let storyPackage = {
      story,
      audit,
      understanding,
      evidencePackage,
      script,
      voice,
      modules: modulePlan.modules,
      totalDurationSec: modulePlan.totalDurationSec,
      audienceGeo: ctx.audienceGeo,
      mode: ctx.mode,
      version: path.basename(outputDir),
      outputDir,
    };
    expectFields(storyPackage, [
      'story', 'audit', 'understanding', 'evidencePackage',
      'script', 'voice', 'modules', 'totalDurationSec',
    ], 'MODULE_PLAN_READY');

    storyPackage = await resolveAssets(storyPackage, outputDir);
    writeJson(outputDir, 'asset-summary.json', storyPackage.asset_summary || {});
    log('ASSETS_READY', summarizeAssetMix(storyPackage.modules));
    expectFields(storyPackage, ['modules', 'asset_summary'], 'ASSETS_READY');

    storyPackage = generateSubtitles(storyPackage, outputDir);
    state = JOB_STATES.SUBTITLES_READY;
    log(state, `${storyPackage.subtitles.length} cues`);
    expectFields(storyPackage, ['subtitles', 'srtPath', 'subtitleCuesPath'], 'SUBTITLES_READY');

    writeJson(outputDir, 'story-package.json', storyPackage);

    // Fallback report — surfaces every silent-degradation path so the user
    // sees "shipped without 1 module due to map_unavailable" rather than a
    // partial video with no record of why.
    const fallbackReport = writeFallbackReport(storyPackage, outputDir);
    if (fallbackReport.has_fallbacks) {
      log('FALLBACKS', summarizeFallbacks(fallbackReport));
    }

    // Dry-run mode: print the report and stop before render. Voice was
    // forced synthetic to skip the TTS API, so its synthetic-timing entry
    // is excluded from the report by buildFallbackReport.
    if (ctx.dryRunFallbacks) {
      state = JOB_STATES.READY_TO_REVIEW;
      const reportPath = path.relative(process.cwd(), path.join(outputDir, 'fallback-report.json'));
      const verdict = fallbackReport.has_fallbacks
        ? `would block production: ${summarizeFallbacks(fallbackReport)}`
        : 'no fallbacks predicted — would pass production gate';
      log('DRY_RUN', `${verdict}. Voice not tested. Report: ${reportPath}`);
      return { state, outputDir, storyPackage, fallbackReport, dryRun: true };
    }

    // Production gate. Refuse to render (or finalise) a story whose
    // fallback report is non-empty unless the operator explicitly opts in.
    // POC mode warns and continues; production fails closed by default.
    if (ctx.mode === 'production' && fallbackReport.has_fallbacks && !ctx.allowFallbacks) {
      const reasons = fallbackReport.items.map((i) => i.kind).join(', ');
      const reportPath = path.relative(process.cwd(), path.join(outputDir, 'fallback-report.json'));
      throw new Error(
        `Production mode refuses to render: ${fallbackReport.count} fallback(s) — ${reasons}. ` +
        `Inspect ${reportPath}. ` +
        `Pass --allow-fallbacks to override.`,
      );
    }

    if (ctx.skipRender) {
      state = JOB_STATES.READY_TO_REVIEW;
      log(state, 'Render skipped (skipRender=true)');
      return { state, outputDir, storyPackage, fallbackReport };
    }

    state = JOB_STATES.RENDERING;
    log(state, `Rendering ${storyPackage.modules.length} modules into MP4`);
    storyPackage = renderVideo(storyPackage, outputDir);
    state = JOB_STATES.RENDER_READY;
    log(state, storyPackage.renderVideoPath || 'render-props.json only');

    writeJson(outputDir, 'story-package-final.json', storyPackage);

    return { state, outputDir, storyPackage, fallbackReport };
  } catch (error) {
    state = JOB_STATES.FAILED;
    if (outputDir) {
      writeJson(outputDir, 'pipeline-failure.json', {
        state,
        error: error.message,
        stack: error.stack,
        failed_at: new Date().toISOString(),
      });
    }
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
    skipRender: Boolean(options.skipRender),
    useAI: Boolean(options.useAI),
    allowFallbacks: Boolean(options.allowFallbacks),
    dryRunFallbacks: Boolean(options.dryRunFallbacks),
    voiceId: options.voiceId || null,
    outputRoot: options.outputRoot || OUTPUT_ROOT,
  };
}

function createOutputDir(ctx, story) {
  const key = story?.id ?? ctx.storyId ?? path.basename(ctx.storyFile || 'story', path.extname(ctx.storyFile || ''));
  const base = path.resolve(ctx.outputRoot, `story-${safeName(key)}`);
  fs.mkdirSync(base, { recursive: true });

  // Atomic version allocation: re-list and try non-recursive mkdir until success.
  // Survives concurrent jobs racing on the same story directory.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const next = nextVersion(base);
    const dir = path.join(base, next);
    try {
      fs.mkdirSync(dir, { recursive: false });
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Another job claimed this version; loop and try the next one.
    }
  }
  throw new Error(`Could not allocate version directory under ${base} after 1000 attempts`);
}

function nextVersion(base) {
  const versions = fs.readdirSync(base)
    .filter((name) => /^v\d+$/.test(name))
    .map((name) => Number(name.slice(1)))
    .sort((a, b) => a - b);
  return `v${(versions[versions.length - 1] || 0) + 1}`;
}

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), 'utf8');
}

function log(state, message) {
  console.log(`[${state}] ${message}`);
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function summarizeUnderstanding(u) {
  const people = (u.entities?.people || []).map((p) => p.name).filter(Boolean).join(', ');
  const money = (u.numbers?.money || []).map((m) => m.display).join(', ');
  return [u.story_type, people, money].filter(Boolean).join(' | ');
}

// Lightweight schema guard. Fails loudly if a stage drops a required field
// from storyPackage — beats a downstream undefined crash with no context.
function expectFields(obj, names, stage) {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`[${stage}] storyPackage is not an object`);
  }
  for (const name of names) {
    if (obj[name] === undefined) {
      throw new Error(`[${stage}] missing required field "${name}" on storyPackage`);
    }
  }
}

function summarizeAssetMix(modules) {
  const counts = {};
  for (const m of modules) {
    const kind = m.asset?.kind || 'graphic';
    counts[kind] = (counts[kind] || 0) + 1;
    if (m.asset?.fallbackReason) {
      counts['fallbacks'] = (counts['fallbacks'] || 0) + 1;
    }
  }
  return Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ');
}

function summarizeEvidence(ep) {
  return [
    `exact:${ep.assets.exact_available.length}`,
    `contextual:${ep.assets.contextual_available.length}`,
    `maps:${ep.assets.maps_needed.length}`,
    `graphics:${ep.assets.graphics_needed.length}`,
    `sources:${ep.source_documents.length}`,
  ].join(', ');
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-');
}

module.exports = {
  runPipeline,
};
