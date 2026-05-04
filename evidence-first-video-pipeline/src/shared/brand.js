'use strict';

const BRAND = {
  name: 'QUYDLY',
  background: '#0A0A0A',
  surface: '#151515',
  surface2: '#202020',
  text: '#FFFFFF',
  muted: '#A8A8A8',
  width: 1080,
  height: 1920,
  fps: 30,
};

const STORY_ACCENTS = {
  legal_scandal: '#E84D5B',
  geopolitics_world: '#42A5F5',
  finance_markets: '#21C7A8',
  tech_cyber: '#B5E853',
  culture_entertainment: '#FFB84D',
  general: '#F2F2F2',
};

function getAccentColor(storyType) {
  return STORY_ACCENTS[storyType] || STORY_ACCENTS.general;
}

module.exports = {
  BRAND,
  STORY_ACCENTS,
  getAccentColor,
};
