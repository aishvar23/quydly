'use strict';

const fs     = require('fs');
const path   = require('path');
const claude = require('../../lib/claude-client');

const SYSTEM_PROMPT = `You are a news intelligence analyst. Extract structured editorial understanding from a news story.
Be specific: use real names, real amounts, real locations from the story. Do not invent or speculate.
Output strict JSON only — no markdown, no commentary.`;

function buildPrompt(story) {
  return `STORY:
Headline: ${story.headline}
Summary: ${story.summary}
Key points:
${story.key_points.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

Extract the following from this story. Use only facts explicitly stated.

OUTPUT FORMAT:
{
  "people": ["Full Name (role if stated) — e.g. 'Gannon Ken Van Dyke (US Army soldier)'"],
  "organizations": ["Org name — e.g. 'US Army', 'Polymarket'"],
  "locations": ["City or Country — e.g. 'Venezuela', 'Caracas'"],
  "numbers": {
    "money": ["$X figure with context — e.g. '$400,000 in wagers'"],
    "counts": ["N figure with context — e.g. '13 wagers placed'"]
  },
  "charges": ["charge noun phrase — e.g. 'wire fraud', 'theft of government information'"],
  "actions": ["what happened — active voice, one sentence — e.g. 'Soldier used classified intel to place bets on Polymarket'"],
  "timeline_events": [
    { "label": "date or stage", "text": "what happened at this point" }
  ],
  "products_or_platforms": ["platform or product name — e.g. 'Polymarket'"],
  "why_it_matters": "one clear sentence on the significance",
  "visualizable_concepts": ["concept keywords — e.g. 'classified documents', 'prediction market', 'legal indictment']"
}

Rules:
- Leave arrays empty [] if nothing applies
- charges: each item should be a short noun phrase suitable for display on screen
- timeline_events: only if the story contains clear chronological sequence (2+ distinct moments)
- why_it_matters: write as a complete sentence, not a list`;
}

async function run(ctx) {
  const { story, storyId, outputDir } = ctx;
  console.log('[03-understand-story] Extracting structured understanding via Claude...');

  const raw = await claude.completeJSON({
    systemPrompt: SYSTEM_PROMPT,
    prompt:       buildPrompt(story),
    maxTokens:    1024,
  });

  const storyUnderstanding = {
    people:                raw.people               || [],
    organizations:         raw.organizations         || [],
    locations:             raw.locations             || [],
    numbers: {
      money:               raw.numbers?.money        || [],
      counts:              raw.numbers?.counts       || [],
    },
    charges:               raw.charges               || [],
    actions:               raw.actions               || [],
    timeline_events:       raw.timeline_events        || [],
    products_or_platforms: raw.products_or_platforms || [],
    why_it_matters:        raw.why_it_matters         || '',
    visualizable_concepts: raw.visualizable_concepts  || [],
  };

  const outPath = path.join(outputDir, `story-${storyId}-understanding.json`);
  fs.writeFileSync(outPath, JSON.stringify(storyUnderstanding, null, 2));

  console.log(`[03-understand-story] ✓ ${storyUnderstanding.people.length} people, ${storyUnderstanding.locations.length} locations, ${storyUnderstanding.charges.length} charges`);
  if (storyUnderstanding.why_it_matters) {
    console.log(`  Why it matters: "${storyUnderstanding.why_it_matters}"`);
  }

  return { storyUnderstanding, storyUnderstandingPath: outPath };
}

module.exports = { run };
