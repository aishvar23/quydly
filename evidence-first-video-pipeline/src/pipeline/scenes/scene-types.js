'use strict';

const SCENE_TYPES = {
  legal_documents: {
    componentType: 'HookScene',
    visualType: 'legal_documents',
    assetClass: 'contextual',
    safetyClass: 'contextual',
    preferredAsset: 'photo',
    allowVideo: false,
    queryTemplates: [
      'classified documents folder on desk',
      'legal documents courthouse paperwork',
      'government files document stack',
    ],
  },
  court_institution: {
    componentType: 'ContextScene',
    visualType: 'court_institution',
    assetClass: 'contextual',
    safetyClass: 'contextual',
    preferredAsset: 'photo',
    allowVideo: false,
    queryTemplates: [
      'courthouse exterior steps',
      'empty courtroom interior',
      'legal scales court documents',
    ],
  },
  government_context: {
    componentType: 'ContextScene',
    visualType: 'government_context',
    assetClass: 'contextual',
    safetyClass: 'contextual',
    preferredAsset: 'photo',
    allowVideo: false,
    queryTemplates: [
      'government building exterior',
      'parliament building exterior',
      'diplomatic building exterior',
    ],
  },
  map_context: {
    componentType: 'MapScene',
    visualType: 'map_context',
    assetClass: 'map',
    safetyClass: 'map',
    preferredAsset: 'map',
    allowVideo: false,
    queryTemplates: [],
  },
  market_data: {
    componentType: 'ContextScene',
    visualType: 'market_data',
    assetClass: 'illustrative',
    safetyClass: 'illustrative',
    preferredAsset: 'video',
    allowVideo: true,
    queryTemplates: [
      'financial market trading screens',
      'stock market chart monitors',
      'economic data dashboard',
    ],
  },
  prediction_market_interface: {
    componentType: 'ContextScene',
    visualType: 'prediction_market_interface',
    assetClass: 'illustrative',
    safetyClass: 'illustrative',
    preferredAsset: 'video',
    allowVideo: true,
    queryTemplates: [
      'online trading platform laptop charts',
      'fintech dashboard trading interface',
      'digital market data screen laptop',
    ],
  },
  tech_interface: {
    componentType: 'ContextScene',
    visualType: 'tech_interface',
    assetClass: 'illustrative',
    safetyClass: 'illustrative',
    preferredAsset: 'video',
    allowVideo: true,
    queryTemplates: [
      'technology interface dashboard',
      'cybersecurity network screen',
      'software data center servers',
    ],
  },
  newsroom_context: {
    componentType: 'ContextScene',
    visualType: 'newsroom_context',
    assetClass: 'contextual',
    safetyClass: 'contextual',
    preferredAsset: 'video',
    allowVideo: true,
    queryTemplates: [
      'empty television newsroom studio',
      'broadcast newsroom desk lights',
      'journalism studio background',
    ],
  },
  data_card: {
    componentType: 'DataScene',
    visualType: 'data_card',
    assetClass: 'data',
    safetyClass: 'data',
    preferredAsset: 'motion',
    allowVideo: false,
    queryTemplates: [],
  },
  impact_motion: {
    componentType: 'ContextScene',
    visualType: 'impact_motion',
    assetClass: 'branded',
    safetyClass: 'abstract',
    preferredAsset: 'motion',
    allowVideo: false,
    queryTemplates: [],
  },
  outro_brand: {
    componentType: 'OutroScene',
    visualType: 'outro_brand',
    assetClass: 'branded',
    safetyClass: 'branded',
    preferredAsset: 'motion',
    allowVideo: false,
    queryTemplates: [],
  },
};

function getSceneType(sceneType) {
  const config = SCENE_TYPES[sceneType];
  if (!config) throw new Error(`Unknown scene type: ${sceneType}`);
  return config;
}

module.exports = {
  SCENE_TYPES,
  getSceneType,
};
