'use strict';

const { completeJSON, hasAnthropic } = require('../../integrations/anthropic');
const { classifyStory, getStoryTemplate } = require('../scenes/story-templates');

async function generateScript(story, audit, { useAI = false } = {}) {
  const storyType = classifyStory(story);
  const template = getStoryTemplate(storyType);

  const script = useAI && hasAnthropic()
    ? await aiScript(story, audit, storyType, template)
    : deterministicScript(story, audit, storyType);

  validateScript(script);
  return {
    ...script,
    story_type: storyType,
    template,
    generation_source: script.generation_source || 'deterministic',
  };
}

function deterministicScript(story, audit, storyType) {
  const points = story.key_points || [];
  const sentences = [
    audit.hook_sentence || story.headline,
    story.summary,
    points[0] ? `The key detail: ${points[0]}` : null,
    points[1] ? `The wider context: ${points[1]}` : null,
    points[2] ? `Why it matters: ${points[2]}` : 'Why it matters: the story has enough support to explain clearly without pretending to show the event itself.',
  ].filter(Boolean);

  const full = fitWordRange(sentences.join(' '), 72, 108);
  const title = makeTitleVariant(story.headline);

  return {
    hook: sentences[0],
    body: sentences.slice(1, -1).join(' '),
    close: sentences[sentences.length - 1],
    full_script: full,
    title_variants: [title, `${title} | Quydly`],
    thumbnail_copy: shortenOverlay(story.headline, 5),
    overlay_phrases: buildOverlayPhrases(story, storyType),
    generation_source: 'deterministic',
  };
}

async function aiScript(story, audit, storyType, template) {
  const system = [
    'You write concise spoken scripts for animated news explainers.',
    'Use only supplied story facts. Do not speculate.',
    'Do not generate asset search queries.',
    'Return strict JSON only.',
  ].join(' ');

  const prompt = `Story:\n${JSON.stringify(story, null, 2)}\n\nAudit:\n${JSON.stringify(audit, null, 2)}\n\nStory type: ${storyType}\nTemplate: ${template.label}\nHook rule: ${template.hookRule}\n\nWrite 72-108 spoken words. Return:\n{
  "hook": "",
  "body": "",
  "close": "",
  "full_script": "",
  "title_variants": ["", ""],
  "thumbnail_copy": "",
  "overlay_phrases": ["", "", "", "", ""]
}`;

  return {
    ...(await completeJSON({ system, prompt, maxTokens: 1400 })),
    generation_source: 'anthropic',
  };
}

function buildOverlayPhrases(story, storyType) {
  const geos = story.primary_geos || [];
  const sourceLabel = story.source_count ? `${story.source_count} source check` : 'Verified cluster';

  const byType = {
    legal_scandal: [
      inferMoneyPhrase(story) || 'Secret files. Real stakes.',
      inferMarketPhrase(story) || 'Betting market angle',
      inferWagerPhrase(story) || sourceLabel,
      geos[0] || inferGeoPhrase(story) || 'Caracas context',
      'Wire fraud charges',
      'Digital betting concerns',
    ],
    geopolitics_world: ['Global stakes', 'Official response', sourceLabel, geos[0] || 'Map context', 'What changes now'],
    finance_markets: ['Market signal', 'Numbers moving', sourceLabel, geos[0] || 'Economic map', 'The takeaway'],
    tech_cyber: ['Tech shift', 'System impact', sourceLabel, geos[0] || 'Network context', 'What to watch'],
    general: ['What happened', 'Key context', sourceLabel, geos[0] || 'Map context', 'Why it matters'],
  };

  return byType[storyType] || byType.general;
}

function inferGeoPhrase(story) {
  const corpus = [story.headline, story.summary, ...(story.key_points || [])].join(' ').toLowerCase();
  if (corpus.includes('caracas')) return 'Caracas context';
  if (corpus.includes('venezuela')) return 'Venezuela context';
  return null;
}

function inferMoneyPhrase(story) {
  const corpus = [story.headline, story.summary, ...(story.key_points || [])].join(' ');
  const match = corpus.match(/\$\s?\d+(?:,\d{3})*(?:\.\d+)?\s?[KMB]?/i);
  return match ? `Secret intel. ${match[0].replace(/\s+/g, '')}.` : null;
}

function inferMarketPhrase(story) {
  const corpus = [story.headline, story.summary, ...(story.key_points || [])].join(' ').toLowerCase();
  if (corpus.includes('polymarket')) return 'Polymarket bets';
  if (corpus.includes('bet')) return 'Prediction market bets';
  return null;
}

function inferWagerPhrase(story) {
  const corpus = [story.headline, story.summary, ...(story.key_points || [])].join(' ');
  const match = corpus.match(/\b(\d{1,3})\s+(?:successful\s+)?wagers?\b/i);
  return match ? `${match[1]} winning wagers` : null;
}

function makeTitleVariant(headline) {
  return headline.length <= 70 ? headline : `${headline.slice(0, 67).trim()}...`;
}

function shortenOverlay(text, maxWords) {
  return String(text)
    .replace(/[^\w\s$.-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');
}

function fitWordRange(text, minWords, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) return `${words.slice(0, maxWords).join(' ')}.`;
  if (words.length >= minWords) return text;

  return [
    text,
    'The explainer keeps the visuals contextual, using maps, documents, charts, and brand motion instead of fake event footage.',
  ].join(' ');
}

function validateScript(script) {
  if (!script.full_script) throw new Error('Script missing full_script');
  const count = script.full_script.split(/\s+/).filter(Boolean).length;
  if (count < 55 || count > 125) {
    throw new Error(`Script word count ${count} outside V1 range`);
  }
  if (!Array.isArray(script.overlay_phrases) || script.overlay_phrases.length < 5) {
    throw new Error('Script must include at least five overlay_phrases');
  }
}

module.exports = {
  generateScript,
  deterministicScript,
  shortenOverlay,
};
