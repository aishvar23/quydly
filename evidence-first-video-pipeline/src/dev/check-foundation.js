'use strict';

require('dotenv').config();

const os = require('os');
const fs = require('fs');
const path = require('path');
const { runPipeline } = require('../pipeline/orchestrator');
const { MODULE_TYPES } = require('../pipeline/modules/module-types');
const { STORY_TYPE_TEMPLATES } = require('../pipeline/modules/story-type-templates');

async function main() {
  assertModuleTypes();
  assertStoryTypeTemplates();

  const outputRoot = path.join(os.tmpdir(), 'quydly-evidence-first-video-pipeline-check');
  fs.rmSync(outputRoot, { recursive: true, force: true });

  const result = await runPipeline({
    storyFile: path.join(__dirname, '..', '..', 'fixtures', 'sample-story.json'),
    audienceGeo: 'global',
    mode: 'poc',
    dryRun: true,
    skipRender: true,
    outputRoot,
  });

  if (!['READY_TO_REVIEW', 'READY_TO_PUBLISH'].includes(result.state)) {
    throw new Error(`Unexpected lint pipeline state: ${result.state}`);
  }

  if (!result.storyPackage.evidencePackage || !result.storyPackage.modules?.length) {
    throw new Error('Foundation check did not produce an evidence package and module plan');
  }

  const requirements = result.storyPackage.evidencePackage.visual_requirements || [];
  if (requirements.length < 5) {
    throw new Error('Evidence package must include story-specific visual requirements');
  }

  assertNarrationQuality(result.storyPackage.script);
  assertSubtitleCues(result.storyPackage.subtitles);
  assertVideoCoversNarration(result.storyPackage);
  assertBackgroundMusic(result.storyPackage.music);
}

function assertModuleTypes() {
  const expected = [
    'HOOK_STRAP',
    'PERSON_CARD',
    'DOSSIER_CARD',
    'MAP_CALLOUT',
    'NUMBER_CARD',
    'CHARGE_CARD',
    'TIMELINE_CARD',
    'PLATFORM_CARD',
    'WHY_IT_MATTERS_CARD',
    'OUTRO_LOCKUP',
  ];

  for (const key of expected) {
    if (!MODULE_TYPES[key]) throw new Error(`Missing module type ${key}`);
  }
}

function assertStoryTypeTemplates() {
  const required = ['legal_scandal', 'geopolitics_world', 'finance_markets', 'tech_cyber'];
  for (const key of required) {
    const template = STORY_TYPE_TEMPLATES[key];
    if (!template) throw new Error(`Missing story-type template ${key}`);
    if (!Array.isArray(template.moduleSequence) || template.moduleSequence.length < 5) {
      throw new Error(`${key} template must include at least five modules`);
    }
    for (const componentType of template.moduleSequence) {
      if (!Object.values(MODULE_TYPES).includes(componentType)) {
        throw new Error(`${key} uses unknown module ${componentType}`);
      }
    }
  }
}

function assertNarrationQuality(script) {
  const text = script.full_script || '';
  const normalized = text.toLowerCase();
  const blockedFragments = [
    'Caracas is context',
    'Caracas anchors',
    'anchors the operation',
    'not claimed operation footage',
    'The test:',
    'the bigger issue is market integrity',
    'YES contracts',
    'the timeline runs from',
    'market integrity',
    'nonpublic government information',
  ];

  for (const fragment of blockedFragments) {
    if (normalized.includes(fragment.toLowerCase())) {
      throw new Error(`Spoken narration still contains robotic fragment: ${fragment}`);
    }
  }

  const sentenceCount = countSpeakableSentences(text);
  if (sentenceCount < 8 || sentenceCount > 10) {
    throw new Error(`Spoken narration should stay in the 8-10 sentence range, got ${sentenceCount}`);
  }
}

function countSpeakableSentences(text) {
  return text
    .replace(/\bU\.S\./g, 'US')
    .replace(/\bU\.K\./g, 'UK')
    .replace(/\bMr\./g, 'Mr')
    .replace(/\bMrs\./g, 'Mrs')
    .replace(/\bMs\./g, 'Ms')
    .replace(/\bDr\./g, 'Dr')
    .replace(/\bJan\./g, 'Jan')
    .replace(/\bFeb\./g, 'Feb')
    .replace(/\bMar\./g, 'Mar')
    .replace(/\bApr\./g, 'Apr')
    .replace(/\bDec\./g, 'Dec')
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function assertSubtitleCues(cues) {
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    const wordCount = cue.text.split(/\s+/).filter(Boolean).length;
    if (wordCount > 7) {
      throw new Error(`Subtitle cue ${index + 1} is too long: ${cue.text}`);
    }
    if (index > 0 && cue.start < cues[index - 1].end - 0.001) {
      throw new Error(`Subtitle cue ${index + 1} overlaps previous cue`);
    }
    if (/^A U\.S\.$/.test(cue.text)) {
      throw new Error('Subtitle cue split U.S. as a sentence');
    }
  }
}

function assertVideoCoversNarration(storyPackage) {
  const lastCueEnd = Math.max(...storyPackage.subtitles.map((cue) => cue.end));
  if (lastCueEnd > storyPackage.totalDurationSec - 0.25) {
    throw new Error(`Video ends before narration is complete: ${storyPackage.totalDurationSec}s < ${lastCueEnd}s`);
  }

  const outro = storyPackage.modules.find((module) => module.role === 'outro');
  if (outro && outro.startSec < lastCueEnd) {
    throw new Error(`Outro starts before narration ends: ${outro.startSec}s < ${lastCueEnd}s`);
  }
}

function assertBackgroundMusic(music) {
  if (!music?.audioPath || !fs.existsSync(music.audioPath)) {
    throw new Error('Foundation check did not produce background music');
  }
  if (music.license !== 'procedural_generated') {
    throw new Error('Background music must be generated or explicitly licensed');
  }
  const size = fs.statSync(music.audioPath).size;
  if (size < 100000) {
    throw new Error('Background music file is unexpectedly small');
  }
  if (music.mixVolume > 0.55) {
    throw new Error('Background music mix is too loud for narration');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
