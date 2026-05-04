'use strict';

const ACCENT_COLORS = {
  legal_scandal:        '#DC143C',  // crimson — severity, legal weight
  geopolitics_conflict: '#1E90FF',  // dodger blue — world affairs, authority
  finance_markets:      '#00CED1',  // turquoise — data, markets
  corporate_leadership: '#FF8C00',  // dark orange — corporate energy
  tech_product:         '#7B68EE',  // medium slate blue — tech, digital
  general:              '#F5F5F5',  // off-white — neutral
};

const BRAND = {
  NAME:        'QUYDLY',
  BG_COLOR:    '#0A0A0A',
  TEXT_WHITE:  '#FFFFFF',
  TEXT_MUTED:  '#AAAAAA',
  FPS:         30,
  WIDTH:       1080,
  HEIGHT:      1920,
};

function getAccentColor(storyType) {
  return ACCENT_COLORS[storyType] || ACCENT_COLORS.general;
}

module.exports = { BRAND, getAccentColor, ACCENT_COLORS };
