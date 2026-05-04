'use strict';

const TEMPLATES = {
  legal_scandal: {
    description: 'Legal scandal / indictment / classified information misuse',
    hook_rule:   'Use classified_documents or newsroom_or_media for the hook. DO NOT use military_personnel_generic as the opening — it implies event footage.',
    scenes: [
      { position: 1, type: 'hook',          preferred: ['classified_documents', 'newsroom_or_media'] },
      { position: 2, type: 'headline',       preferred: ['prediction_market_or_tech', 'financial_markets'] },
      { position: 3, type: 'detail',         preferred: ['courtroom_or_legal', 'government_building'] },
      { position: 4, type: 'detail',         preferred: ['geo_map'] },
      { position: 5, type: 'why_it_matters', preferred: ['financial_markets', 'newsroom_or_media'] },
      { position: 6, type: 'outro',          preferred: ['brand_outro'] },
    ],
  },

  geopolitics_conflict: {
    description: 'Geopolitics / armed conflict / international crisis',
    hook_rule:   'Use newsroom_or_media or government_building for the hook. Military visuals belong in detail scenes only.',
    scenes: [
      { position: 1, type: 'hook',          preferred: ['newsroom_or_media', 'government_building'] },
      { position: 2, type: 'headline',       preferred: ['geo_map'] },
      { position: 3, type: 'detail',         preferred: ['government_building', 'military_personnel_generic'] },
      { position: 4, type: 'detail',         preferred: ['geo_map'] },
      { position: 5, type: 'why_it_matters', preferred: ['newsroom_or_media', 'financial_markets'] },
      { position: 6, type: 'outro',          preferred: ['brand_outro'] },
    ],
  },

  finance_markets: {
    description: 'Finance / markets / macroeconomics',
    hook_rule:   'Use financial_markets or newsroom_or_media for the hook.',
    scenes: [
      { position: 1, type: 'hook',          preferred: ['financial_markets', 'newsroom_or_media'] },
      { position: 2, type: 'headline',       preferred: ['financial_markets', 'prediction_market_or_tech'] },
      { position: 3, type: 'detail',         preferred: ['government_building', 'courtroom_or_legal'] },
      { position: 4, type: 'geo',            preferred: ['geo_map', 'government_building'] },
      { position: 5, type: 'why_it_matters', preferred: ['financial_markets', 'newsroom_or_media'] },
      { position: 6, type: 'outro',          preferred: ['brand_outro'] },
    ],
  },

  corporate_leadership: {
    description: 'Corporate leadership / M&A / company news',
    hook_rule:   'Use newsroom_or_media or financial_markets for the hook.',
    scenes: [
      { position: 1, type: 'hook',          preferred: ['newsroom_or_media', 'financial_markets'] },
      { position: 2, type: 'headline',       preferred: ['prediction_market_or_tech', 'financial_markets'] },
      { position: 3, type: 'detail',         preferred: ['government_building', 'courtroom_or_legal'] },
      { position: 4, type: 'geo',            preferred: ['geo_map', 'newsroom_or_media'] },
      { position: 5, type: 'why_it_matters', preferred: ['financial_markets', 'newsroom_or_media'] },
      { position: 6, type: 'outro',          preferred: ['brand_outro'] },
    ],
  },

  tech_product: {
    description: 'Technology / product launch / cybersecurity',
    hook_rule:   'Use prediction_market_or_tech or newsroom_or_media for the hook.',
    scenes: [
      { position: 1, type: 'hook',          preferred: ['prediction_market_or_tech', 'newsroom_or_media'] },
      { position: 2, type: 'headline',       preferred: ['prediction_market_or_tech', 'financial_markets'] },
      { position: 3, type: 'detail',         preferred: ['government_building', 'courtroom_or_legal'] },
      { position: 4, type: 'geo',            preferred: ['geo_map', 'newsroom_or_media'] },
      { position: 5, type: 'why_it_matters', preferred: ['financial_markets', 'newsroom_or_media'] },
      { position: 6, type: 'outro',          preferred: ['brand_outro'] },
    ],
  },

  general: {
    description: 'General news',
    hook_rule:   'Use newsroom_or_media for a credible, neutral opening.',
    scenes: [
      { position: 1, type: 'hook',          preferred: ['newsroom_or_media', 'classified_documents'] },
      { position: 2, type: 'headline',       preferred: ['government_building', 'financial_markets'] },
      { position: 3, type: 'detail',         preferred: ['courtroom_or_legal', 'newsroom_or_media'] },
      { position: 4, type: 'detail',         preferred: ['geo_map'] },
      { position: 5, type: 'why_it_matters', preferred: ['newsroom_or_media', 'financial_markets'] },
      { position: 6, type: 'outro',          preferred: ['brand_outro'] },
    ],
  },
};

function getTemplate(storyType) {
  return TEMPLATES[storyType] || TEMPLATES.general;
}

module.exports = { getTemplate };
