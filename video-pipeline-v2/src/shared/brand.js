'use strict';

// Node-side mirror of render/shared/brand.ts. Only the accent palette and
// editorial voice constants are consumed outside of Remotion components.

const BRAND_VOICE = {
  // Editorial sign-off used in every video's outro narration + lockup.
  tagline: 'Know the story. Keep the receipts.',
  // Brand label shown as overlay text on the OutroLockup module.
  brandLabel: 'Quydly',
};

const STORY_ACCENTS = {
  legal_scandal:        '#E84D5B',
  geopolitics_world:    '#42A5F5',
  finance_markets:      '#21C7A8',
  election_result:      '#9C7CFF',
  natural_disaster:     '#FF8B5A',
  tech_cyber:           '#B5E853',
  culture_entertainment: '#FFB84D',
  general:              '#F2F2F2',
};

function getAccentColor(storyType) {
  return STORY_ACCENTS[storyType] || STORY_ACCENTS.general;
}

module.exports = {
  BRAND_VOICE,
  STORY_ACCENTS,
  getAccentColor,
};
