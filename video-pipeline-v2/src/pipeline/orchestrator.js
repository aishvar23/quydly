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
const { computePublishability } = require('./audit/publishability');
const { generateVideoBrief } = require('./brief/generate-video-brief');
const { validateVideoBrief } = require('./brief/validate-video-brief');
const { buildHormuzStoryboard } = require('./storyboard/generate-storyboard');
const { validateStoryboard } = require('./storyboard/validate-storyboard');
const { understandStory } = require('./understand/understand-story');
const { generateEvidencePackage } = require('./evidence/evidence-package');
const { generateScript } = require('./script/generate-script');
const { generateVoice } = require('./voice/generate-voice');
const { planModules } = require('./modules/plan-modules');
const { generateSubtitles } = require('./subtitles/generate-srt');
const { resolveAssets } = require('./assets/resolve-assets');
const { renderVideo } = require('./render/render-video');
const { buildYoutubePackage } = require('./youtube/build-youtube-package');
const { renderThumbnail } = require('./youtube/render-thumbnail');
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

    // Bridge phase 1 — publishability gate. INFORMATIVE: emits a
    // publishability.json artifact + logs the verdict. Doesn't block
    // the pipeline; downstream modules will badge non-publishable
    // renders as DEVELOPING / UNVERIFIED so the operator can see why
    // a story was gated without losing the render entirely.
    const publishability = computePublishability(story);
    writeJson(outputDir, 'publishability.json', publishability);
    log('PUBLISHABILITY', `${publishability.risk_label} (publishable=${publishability.publishable}; blocks=[${publishability.blocks.join(', ')}])`);

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

    // Bridge phase 2 — produce the editorial video_brief from story +
    // evidence + publishability. The brief carries the 7-scene story
    // arc, ≤7-word onscreen text, meaningful timeline labels, and
    // compressed source receipts. Modules read from it instead of
    // assembling their own data from the evidence package.
    const videoBrief = generateVideoBrief({ story, evidencePackage, publishability });
    writeJson(outputDir, 'video-brief.json', videoBrief);
    const briefValidation = validateVideoBrief(videoBrief);
    writeJson(outputDir, 'video-brief-validation.json', briefValidation);
    log(
      'VIDEO_BRIEF',
      `${videoBrief.scenes.length} scenes; ` +
      `developing_badge=${videoBrief.developing_badge ?? 'none'}; ` +
      `validation ok=${briefValidation.ok} errors=${briefValidation.errors.length} warnings=${briefValidation.warnings.length}`,
    );
    if (!briefValidation.ok) {
      for (const err of briefValidation.errors.slice(0, 5)) {
        log('VIDEO_BRIEF_ERROR', err);
      }
    }
    // Attach the brief to the evidence package so the per-story-type
    // template() readers can pull short hook text / meaningful timeline
    // labels / compressed receipts from it.
    evidencePackage.brief = videoBrief;

    // Bridge phase 4 — Storyboard + RenderValidation.
    //
    // Storyboard is the strict scene-by-scene shot list. Validator
    // BLOCKS render before MP4 export when any hard rule fails — no
    // more shipping bad MP4s with placeholder-card visuals.
    //
    // Currently only geopolitics_world has a deterministic storyboard
    // generator (the Hormuz template) AND the renderer components for
    // its shot_types are not yet implemented (Phase 5 work). Routing
    // a story here therefore guarantees RENDER_BLOCKED. Gate strictly
    // on the matched story_type so legal_scandal / culture / finance
    // stories that happen to carry category_id="world" go through the
    // legacy module pipeline that DOES have working renderers.
    let storyboard = null;
    let storyboardValidation = null;
    if (understanding.story_type === 'geopolitics_world') {
      storyboard = buildHormuzStoryboard({ story, brief: videoBrief });
      writeJson(outputDir, 'storyboard.json', storyboard);
      storyboardValidation = validateStoryboard(storyboard);
      writeJson(outputDir, 'storyboard-validation.json', storyboardValidation);
      log(
        'STORYBOARD',
        `${storyboard.scenes.length} scenes; ${storyboard.total_duration_sec}s; ` +
        `validation ok=${storyboardValidation.ok} hard_fails=${storyboardValidation.summary.hard_fails}`,
      );
    }

    if (storyboardValidation && !storyboardValidation.ok && !ctx.bypassStoryboardValidation) {
      // Hard-fail block. Write a render-blocked report and skip the
      // remaining stages (voice / modules / render). Fail loud — the
      // editor must see exactly which rules tripped, not get yet
      // another "render OK" with a bad MP4.
      const blockedReport = {
        story_id: story.id,
        story_type: story.story_type,
        outputDir,
        blocked_at: 'pre-render',
        reason: 'storyboard validation failed; refusing to render',
        first_failures: storyboardValidation.errors.slice(0, 10),
        all_failures: storyboardValidation.errors,
        summary: storyboardValidation.summary,
      };
      writeJson(outputDir, 'render-blocked.json', blockedReport);
      log('RENDER_BLOCKED', `${storyboardValidation.errors.length} hard rule(s) failed; see render-blocked.json`);
      for (const err of storyboardValidation.errors.slice(0, 8)) {
        log('STORYBOARD_FAIL', `[${err.rule}] ${err.detail}`);
      }
      // Bail out cleanly — DO NOT invoke the renderer.
      return {
        state: 'RENDER_BLOCKED',
        outputDir,
        story,
        storyboard,
        storyboardValidation,
      };
    }

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

    // YouTube package: title.txt, description.md, sources.md, thumbnail.png.
    // Opt-in via --youtube. The thumbnail uses a separate Remotion
    // composition (1280x720 still) sharing the brand + icon library.
    if (ctx.youtube) {
      const yt = buildYoutubePackage(storyPackage, outputDir);
      const thumbnailPath = path.join(yt.youtubeDir, 'thumbnail.png');
      try {
        renderThumbnail({
          propsPath: yt.thumbnailPropsPath,
          outputPath: thumbnailPath,
        });
        storyPackage.youtube = {
          ...yt,
          thumbnailPath,
        };
        log('YOUTUBE_READY', `package at ${path.relative(process.cwd(), yt.youtubeDir)}`);
      } catch (err) {
        log('YOUTUBE_THUMBNAIL_FAILED', err.message);
        storyPackage.youtube = { ...yt, thumbnailPath: null, thumbnailError: err.message };
      }
    }

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
    youtube: Boolean(options.youtube),
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
