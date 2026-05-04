'use strict';

// visual_treatment classifies how an asset relates to the story:
//   contextual   — real footage of similar environments (courtrooms, newsrooms, generic military)
//   illustrative — related but not event-specific (charts, market screens, documents)
//   map          — geographic visualization
//   abstract     — motion graphics, branded background
//   branded      — outro / brand lockup

const VISUAL_CONCEPTS = {
  military_personnel_generic: {
    queries: [
      'military personnel uniform training',
      'soldiers army generic exercise',
      'armed forces training ground',
    ],
    prefer:          'photo',       // V2: risky concept defaults to photo not video
    visual_treatment: 'contextual',
    dalle_allowed:   true,
    dalle_prompt:    'generic military personnel in uniform, no identifiable faces, photorealistic, no text',
  },

  government_building: {
    queries: [
      'US Capitol building exterior Washington DC',
      'federal government building facade',
      'government institution exterior architecture',
    ],
    prefer:          'photo',
    visual_treatment: 'contextual',
    dalle_allowed:   false,
  },

  courtroom_or_legal: {
    queries: [
      'courthouse exterior architecture steps',
      'empty courtroom interior wooden bench',
      'scales of justice law court',
      'legal indictment documents federal court',
    ],
    prefer:          'photo',
    visual_treatment: 'contextual',
    dalle_allowed:   true,
    dalle_prompt:    'empty federal courtroom interior dramatic overhead lighting, wooden benches, american flag, no people, no faces, photorealistic',
  },

  financial_markets: {
    queries: [
      'stock market trading screens financial data',
      'financial charts markets analysis monitors',
      'trading screens data close-up',
    ],
    prefer:          'video',
    visual_treatment: 'illustrative',
    dalle_allowed:   true,
    dalle_prompt:    'financial trading screens with charts, abstract close-up, no faces, photorealistic',
  },

  geo_map: {
    queries: [
      'world map satellite aerial view',
      'globe earth aerial geography',
    ],
    prefer:          'map',
    visual_treatment: 'map',
    dalle_allowed:   false,
  },

  newsroom_or_media: {
    queries: [
      'empty broadcast newsroom studio television',
      'news anchor desk empty studio lights',
      'broadcast journalism studio interior',
    ],
    prefer:          'video',
    visual_treatment: 'contextual',
    dalle_allowed:   false,
  },

  classified_documents: {
    queries: [
      'classified documents folder government papers',
      'secret files envelope documents desk',
      'government paperwork official documents stack',
    ],
    prefer:          'photo',
    visual_treatment: 'illustrative',
    dalle_allowed:   true,
    dalle_prompt:    'stack of classified government document folders on desk, dramatic side lighting, no readable text, photorealistic',
  },

  prediction_market_or_tech: {
    queries: [
      'online trading platform laptop screen',
      'digital prediction market interface charts',
      'fintech digital platform interface data',
    ],
    prefer:          'video',
    visual_treatment: 'illustrative',
    dalle_allowed:   true,
    dalle_prompt:    'abstract digital trading interface with glowing charts on dark background, no people, photorealistic',
  },

  brand_outro: {
    queries:         [],
    prefer:          'abstract',
    visual_treatment: 'branded',
    dalle_allowed:   false,
  },
};

// Concepts where video is blocked — use photo/map/illustrative only.
// Prevents implying direct footage of named real events.
const VIDEO_BLOCKED = new Set([
  'military_personnel_generic',
  'classified_documents',
  'courtroom_or_legal',
]);

function getConcept(key) {
  const c = VISUAL_CONCEPTS[key];
  if (!c) throw new Error(`Unknown safe_visual_concept: "${key}"`);
  return { ...c, key };
}

function isVideoBlocked(key) {
  return VIDEO_BLOCKED.has(key);
}

module.exports = { VISUAL_CONCEPTS, getConcept, isVideoBlocked };
