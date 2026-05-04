'use strict';

const fs     = require('fs');
const path   = require('path');
const claude = require('../../lib/claude-client');
const { classifyStory }  = require('../../lib/story-type-classifier');
const { getTemplate }    = require('../../lib/story-type-templates');

const VALID_CONCEPTS = [
  'military_personnel_generic',
  'government_building',
  'courtroom_or_legal',
  'financial_markets',
  'geo_map',
  'newsroom_or_media',
  'classified_documents',
  'prediction_market_or_tech',
  'brand_outro',
];

const VALID_PURPOSES = [
  'establish_stakes',
  'introduce_subject',
  'provide_detail',
  'list_charges',
  'explain_impact',
  'brand_close',
];

const SYSTEM_PROMPT = `You write short-form animated news explainer video scripts.
Use only story data provided. Do not speculate or add unsupported facts.
Write for speech, not for on-screen reading.
Output strict JSON only — no markdown fences, no extra text.`;

function buildPrompt(story, storyType, template) {
  const sceneGuidance = template.scenes.map(s =>
    `  Scene ${s.position} (${s.type}): preferred concepts → [${s.preferred.join(', ')}]`
  ).join('\n');

  return `STORY DATA:
${JSON.stringify(story, null, 2)}

STORY TYPE: ${storyType} — ${template.description}

HOOK RULE: ${template.hook_rule}

SCENE SEQUENCE (follow this order):
${sceneGuidance}

TASK: Generate a video script and 6-scene plan.

SCRIPT REQUIREMENTS:
- total 80–110 words
- tone: factual, concise, natural for spoken delivery
- no clickbait, no speculation
- structure: hook → context → key detail → consequence → why it matters → close

SCENE PLAN REQUIREMENTS:
For each scene output ONLY these fields:
  scene_id            integer 1–6
  type                one of: hook | headline | detail | charges | why_it_matters | outro
  overlay_text        3–5 WORDS MAXIMUM — punchy editorial strap. Scene 1 MUST be ultra-short and curiosity-driving (like "$400K in bets?" or "Secret intel. Cash."). Other scenes: like "Wire fraud filed" or "Bets placed" — NOT a full sentence.
  scene_purpose       MUST be exactly one of: ${VALID_PURPOSES.join(' | ')}
  safe_visual_concept MUST be exactly one of: ${VALID_CONCEPTS.join(' | ')} — pick from preferred list
  geo_location        country or city name — ONLY when safe_visual_concept is geo_map, otherwise omit
  narration_segment   the exact contiguous words from full_script spoken during this scene

CRITICAL RULES:
- overlay_text is a 3–5 word editorial strap, never a full sentence
- Do NOT generate Pexels search queries — only safe_visual_concept from the enum
- Do NOT imply direct footage of named real events or individuals
- Scene 6 must always use safe_visual_concept: brand_outro with narration_segment: ""
- narration_segment fields for scenes 1–5 must cover the entire full_script with no gaps

OUTPUT FORMAT (strict JSON):
{
  "hook": "...",
  "body": "...",
  "close": "...",
  "full_script": "...",
  "estimated_duration_sec": 42,
  "story_type": "${storyType}",
  "scenes": [
    {
      "scene_id": 1,
      "type": "hook",
      "overlay_text": "Secret intel. Cash bets.",
      "scene_purpose": "establish_stakes",
      "safe_visual_concept": "classified_documents",
      "narration_segment": "..."
    }
  ]
}`;
}

async function run(ctx) {
  const { story, storyId, outputDir } = ctx;

  const storyType = classifyStory(story);
  const template  = getTemplate(storyType);
  console.log(`[03-script-generation] Story type: ${storyType}`);
  console.log('[03-script-generation] Calling Claude for script + scene plan...');

  const parsed = await claude.completeJSON({
    systemPrompt: SYSTEM_PROMPT,
    prompt:       buildPrompt(story, storyType, template),
    maxTokens:    2048,
  });

  const wordCount = parsed.full_script.trim().split(/\s+/).length;
  if (wordCount < 65 || wordCount > 120) {
    throw new Error(`[script] Word count ${wordCount} out of range 65–120`);
  }

  if (!Array.isArray(parsed.scenes) || parsed.scenes.length !== 6) {
    throw new Error(`[script] Expected 6 scenes, got ${parsed.scenes?.length}`);
  }

  for (const scene of parsed.scenes) {
    if (!VALID_CONCEPTS.includes(scene.safe_visual_concept)) {
      throw new Error(`[script] Invalid safe_visual_concept: "${scene.safe_visual_concept}"`);
    }
    if (!VALID_PURPOSES.includes(scene.scene_purpose)) {
      throw new Error(`[script] Invalid scene_purpose: "${scene.scene_purpose}"`);
    }
    const isOutro = scene.safe_visual_concept === 'brand_outro';
    if (!isOutro && (!scene.narration_segment || !scene.narration_segment.trim())) {
      throw new Error(`[script] Scene ${scene.scene_id} missing narration_segment`);
    }
    if (isOutro) scene.narration_segment = '';

    // Truncate silently if Claude exceeded overlay_text word limit
    const overlayWords = (scene.overlay_text || '').trim().split(/\s+/);
    if (overlayWords.length > 6) {
      scene.overlay_text = overlayWords.slice(0, 5).join(' ');
    }
  }

  if (parsed.scenes[5].safe_visual_concept !== 'brand_outro') {
    throw new Error('[script] Last scene must use brand_outro');
  }

  // Placeholder durations — beat alignment refines after audio
  const avgSecPerWord = 0.4;
  for (const scene of parsed.scenes) {
    const words = scene.narration_segment.trim().split(/\s+/).filter(Boolean).length;
    scene.duration_sec = Math.max(parseFloat((words * avgSecPerWord + 0.5).toFixed(2)), 2.5);
  }

  const scriptPath = path.join(outputDir, `story-${storyId}-script.json`);
  fs.writeFileSync(scriptPath, JSON.stringify(parsed, null, 2));

  console.log(`[03-script-generation] ✓ ${wordCount} words, ${parsed.scenes.length} scenes (${storyType}) → ${path.basename(scriptPath)}`);
  return { script: parsed, scriptPath, storyType };
}

module.exports = { run };
