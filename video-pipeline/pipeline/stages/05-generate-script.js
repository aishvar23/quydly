'use strict';

const fs     = require('fs');
const path   = require('path');
const claude = require('../../lib/claude-client');
const { classifyStory } = require('../../lib/story-type-classifier');
const { getTemplate }   = require('../../lib/story-type-templates');

const SYSTEM_PROMPT = `You write short-form animated news explainer scripts.
Each video is built from editorial modules — not stock footage. Write narration that works with text cards, maps, and data graphics.
Output strict JSON only — no markdown fences, no extra text.`;

function buildPrompt(story, evidencePackage, storyType, template) {
  const ep = evidencePackage;
  const moduleSummary = template.modules.map((m, i) =>
    `  ${i + 1}. ${m.type}${m.narration_hint ? ` — ${m.narration_hint}` : ' (no narration)'}`
  ).join('\n');

  return `STORY:
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${story.key_points.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

EVIDENCE AVAILABLE:
People: ${ep.entities.people.join(', ') || 'none'}
Organizations: ${ep.entities.organizations.join(', ') || 'none'}
Locations: ${ep.entities.locations.join(', ') || 'none'}
Money figures: ${ep.numbers.money.join(', ') || 'none'}
Count figures: ${ep.numbers.counts.join(', ') || 'none'}
Charges: ${ep.legal.charges.join(', ') || 'none'}

VIDEO FORMAT:
Story type: ${storyType}
Module sequence (each module shows what it shows — write narration to match):
${moduleSummary}

TASK: Write a 70–100 word spoken narration script split across modules.

RULES:
- Hook must grab immediate attention with the most specific surprising fact
- Each module narration covers only what that module shows — no repetition
- OutroLockup narration must be "" (empty string)
- Factual only — no clickbait, no speculation, nothing not in the story
- Write for spoken delivery, not for reading

OUTPUT FORMAT (strict JSON):
{
  "hook": "One punchy hook sentence",
  "full_script": "Complete 70–100 word narration in sequence",
  "estimated_duration_sec": 42,
  "story_type": "${storyType}",
  "module_narrations": [
    ${template.modules.map(m => `{ "module_type": "${m.type}", "narration": "${m.narration_hint ? '...' : ''}" }`).join(',\n    ')}
  ]
}

CRITICAL:
- module_narrations must follow this exact type sequence: ${template.modules.map(m => m.type).join(' → ')}
- full_script = all non-empty module narrations joined in order
- No invented facts`;
}

async function run(ctx) {
  const { story, storyId, evidencePackage, outputDir } = ctx;

  const storyType = classifyStory(story);
  const template  = getTemplate(storyType);

  console.log(`[05-generate-script] Story type: ${storyType} | ${template.modules.length} modules`);
  console.log('[05-generate-script] Generating evidence-driven script via Claude...');

  const parsed = await claude.completeJSON({
    systemPrompt: SYSTEM_PROMPT,
    prompt:       buildPrompt(story, evidencePackage, storyType, template),
    maxTokens:    2048,
  });

  const wordCount = (parsed.full_script || '').trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 50 || wordCount > 110) {
    throw new Error(`[script] Word count ${wordCount} out of range 50–110`);
  }

  if (!Array.isArray(parsed.module_narrations) || parsed.module_narrations.length !== template.modules.length) {
    throw new Error(`[script] Expected ${template.modules.length} module_narrations, got ${parsed.module_narrations?.length}`);
  }

  for (let i = 0; i < template.modules.length; i++) {
    const expected = template.modules[i].type;
    const actual   = parsed.module_narrations[i]?.module_type;
    if (actual !== expected) {
      throw new Error(`[script] Module ${i + 1} type mismatch: expected "${expected}", got "${actual}"`);
    }
  }

  const script = {
    hook:                   parsed.hook,
    full_script:            parsed.full_script,
    estimated_duration_sec: parsed.estimated_duration_sec || 42,
    story_type:             storyType,
    module_narrations:      parsed.module_narrations,
  };

  const scriptPath = path.join(outputDir, `story-${storyId}-script.json`);
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));

  console.log(`[05-generate-script] ✓ ${wordCount} words, ${parsed.module_narrations.length} modules (${storyType})`);
  return { script, scriptPath, storyType };
}

module.exports = { run };
