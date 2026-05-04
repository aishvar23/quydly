'use strict';

const STORY_TYPE_KEYWORDS = {
  legal_scandal: [
    'fraud',
    'charge',
    'charged',
    'indict',
    'court',
    'prosecutor',
    'classified',
    'lawsuit',
    'corruption',
    'conspiracy',
  ],
  geopolitics_world: [
    'war',
    'military',
    'sanction',
    'diplomat',
    'border',
    'minister',
    'missile',
    'ceasefire',
    'treaty',
    'election',
  ],
  finance_markets: [
    'market',
    'stock',
    'inflation',
    'tariff',
    'bank',
    'rate',
    'earnings',
    'gdp',
    'trade',
    'commodity',
  ],
  tech_cyber: [
    'ai',
    'cyber',
    'hack',
    'software',
    'chip',
    'data breach',
    'platform',
    'app',
    'model',
    'cloud',
  ],
};

const STORY_TEMPLATES = {
  legal_scandal: {
    label: 'Legal / scandal',
    hookRule: 'Lead with documents, institutional stakes, or verified legal action. Avoid anything that looks like direct footage of a named incident.',
    scenes: [
      { role: 'hook', sceneType: 'legal_documents', purpose: 'establish_stakes' },
      { role: 'context', sceneType: 'prediction_market_interface', purpose: 'introduce_subject' },
      { role: 'detail', sceneType: 'data_card', purpose: 'surface_key_fact' },
      { role: 'location', sceneType: 'map_context', purpose: 'anchor_geography' },
      { role: 'charges', sceneType: 'court_institution', purpose: 'list_charges' },
      { role: 'impact', sceneType: 'newsroom_context', purpose: 'explain_impact' },
      { role: 'outro', sceneType: 'outro_brand', purpose: 'brand_close' },
    ],
  },
  geopolitics_world: {
    label: 'Geopolitics / world',
    hookRule: 'Use maps and institutions first. Military visuals are generic context only and never imply direct battle footage.',
    scenes: [
      { role: 'hook', sceneType: 'map_context', purpose: 'establish_stakes' },
      { role: 'context', sceneType: 'government_context', purpose: 'introduce_subject' },
      { role: 'detail', sceneType: 'data_card', purpose: 'surface_key_fact' },
      { role: 'location', sceneType: 'map_context', purpose: 'anchor_geography' },
      { role: 'impact', sceneType: 'newsroom_context', purpose: 'explain_impact' },
      { role: 'outro', sceneType: 'outro_brand', purpose: 'brand_close' },
    ],
  },
  finance_markets: {
    label: 'Finance / markets',
    hookRule: 'Lead with the number, chart, or market movement. Keep visuals abstract and data-forward.',
    scenes: [
      { role: 'hook', sceneType: 'market_data', purpose: 'establish_stakes' },
      { role: 'context', sceneType: 'data_card', purpose: 'introduce_subject' },
      { role: 'detail', sceneType: 'market_data', purpose: 'surface_key_fact' },
      { role: 'location', sceneType: 'map_context', purpose: 'anchor_geography' },
      { role: 'impact', sceneType: 'impact_motion', purpose: 'explain_impact' },
      { role: 'outro', sceneType: 'outro_brand', purpose: 'brand_close' },
    ],
  },
  tech_cyber: {
    label: 'Tech / cyber',
    hookRule: 'Use product, interface, network, or diagram-like visuals. Avoid fake screenshots of private systems.',
    scenes: [
      { role: 'hook', sceneType: 'tech_interface', purpose: 'establish_stakes' },
      { role: 'context', sceneType: 'newsroom_context', purpose: 'introduce_subject' },
      { role: 'detail', sceneType: 'data_card', purpose: 'surface_key_fact' },
      { role: 'location', sceneType: 'map_context', purpose: 'anchor_geography' },
      { role: 'impact', sceneType: 'impact_motion', purpose: 'explain_impact' },
      { role: 'outro', sceneType: 'outro_brand', purpose: 'brand_close' },
    ],
  },
  general: {
    label: 'General news',
    hookRule: 'Use newsroom, institutional, map, or data visuals. Stay contextual and non-literal.',
    scenes: [
      { role: 'hook', sceneType: 'newsroom_context', purpose: 'establish_stakes' },
      { role: 'context', sceneType: 'government_context', purpose: 'introduce_subject' },
      { role: 'detail', sceneType: 'data_card', purpose: 'surface_key_fact' },
      { role: 'location', sceneType: 'map_context', purpose: 'anchor_geography' },
      { role: 'impact', sceneType: 'impact_motion', purpose: 'explain_impact' },
      { role: 'outro', sceneType: 'outro_brand', purpose: 'brand_close' },
    ],
  },
};

function classifyStory(story) {
  const corpus = [
    story.category_id,
    story.headline,
    story.summary,
    ...(story.key_points || []),
  ].join(' ').toLowerCase();

  const scores = Object.entries(STORY_TYPE_KEYWORDS).map(([storyType, keywords]) => {
    const score = keywords.reduce((sum, keyword) => (
      corpus.includes(keyword.toLowerCase()) ? sum + 1 : sum
    ), 0);
    return [storyType, score];
  }).sort((a, b) => b[1] - a[1]);

  return scores[0][1] > 0 ? scores[0][0] : 'general';
}

function getStoryTemplate(storyType) {
  return STORY_TEMPLATES[storyType] || STORY_TEMPLATES.general;
}

module.exports = {
  STORY_TEMPLATES,
  classifyStory,
  getStoryTemplate,
};
