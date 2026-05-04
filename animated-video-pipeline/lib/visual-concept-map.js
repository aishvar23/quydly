'use strict';

const VISUAL_CONCEPTS = {
  military_personnel_generic: {
    queries:          ['military personnel uniform training', 'soldiers army generic exercise', 'armed forces training ground'],
    prefer:           'photo',
    visual_treatment: 'contextual',
  },
  government_building: {
    queries:          ['US Capitol building exterior Washington DC', 'federal government building facade', 'government institution exterior architecture'],
    prefer:           'photo',
    visual_treatment: 'contextual',
  },
  courtroom_or_legal: {
    queries:          ['courthouse exterior architecture steps', 'empty courtroom interior wooden bench', 'scales of justice law court', 'legal documents federal court'],
    prefer:           'photo',
    visual_treatment: 'contextual',
  },
  financial_markets: {
    queries:          ['stock market trading screens financial data', 'financial charts markets analysis monitors', 'trading screens data close-up'],
    prefer:           'video',
    visual_treatment: 'illustrative',
  },
  geo_map: {
    queries:          ['world map satellite aerial view', 'globe earth aerial geography'],
    prefer:           'map',
    visual_treatment: 'map',
  },
  newsroom_or_media: {
    queries:          ['empty broadcast newsroom studio television', 'news anchor desk empty studio lights', 'broadcast journalism studio interior'],
    prefer:           'video',
    visual_treatment: 'contextual',
  },
  classified_documents: {
    queries:          ['classified documents folder government papers', 'secret files envelope documents desk', 'government paperwork official documents stack'],
    prefer:           'photo',
    visual_treatment: 'illustrative',
  },
  prediction_market_or_tech: {
    queries:          ['online trading platform laptop screen', 'digital prediction market interface charts', 'fintech digital platform interface data'],
    prefer:           'video',
    visual_treatment: 'illustrative',
  },
  brand_outro: {
    queries:          [],
    prefer:           'abstract',
    visual_treatment: 'branded',
  },
};

// Concepts where video is blocked — prevents implying direct event footage
const VIDEO_BLOCKED = new Set(['military_personnel_generic', 'classified_documents', 'courtroom_or_legal']);

function getConcept(key) {
  const c = VISUAL_CONCEPTS[key];
  if (!c) throw new Error(`Unknown safe_visual_concept: "${key}"`);
  return { ...c, key };
}

function isVideoBlocked(key) {
  return VIDEO_BLOCKED.has(key);
}

module.exports = { VISUAL_CONCEPTS, getConcept, isVideoBlocked };
