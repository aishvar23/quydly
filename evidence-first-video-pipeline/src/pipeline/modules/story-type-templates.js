'use strict';

const STORY_TYPE_TEMPLATES = {
  legal_scandal: {
    id: 'legal_scandal_v3',
    label: 'Legal / scandal',
    moduleSequence: [
      'HookStrap',
      'DossierCard',
      'PersonCard',
      'PlatformCard',
      'NumberCard',
      'MapCallout',
      'ChargeCard',
      'TimelineCard',
      'WhyItMattersCard',
      'OutroLockup',
    ],
    visualPriority: ['source_document', 'named_person', 'platform', 'money', 'map', 'charges', 'timeline'],
  },
  geopolitics_world: {
    id: 'geopolitics_world_v1',
    label: 'Geopolitics / world',
    moduleSequence: [
      'HookStrap',
      'DossierCard',
      'PersonCard',
      'MapCallout',
      'TimelineCard',
      'WhyItMattersCard',
      'OutroLockup',
    ],
    visualPriority: ['named_person_or_event', 'source_brief', 'map', 'timeline', 'stakeholders'],
  },
  finance_markets: {
    id: 'finance_markets_v1',
    label: 'Finance / markets',
    moduleSequence: [
      'HookStrap',
      'NumberCard',
      'PlatformCard',
      'MapCallout',
      'WhyItMattersCard',
      'OutroLockup',
    ],
    visualPriority: ['number', 'market_or_platform', 'money_flow', 'map_if_relevant'],
  },
  tech_cyber: {
    id: 'tech_cyber_v1',
    label: 'Tech / cyber',
    moduleSequence: [
      'HookStrap',
      'PlatformCard',
      'DossierCard',
      'NumberCard',
      'WhyItMattersCard',
      'OutroLockup',
    ],
    visualPriority: ['product_or_platform', 'system_diagram', 'impact_number', 'risk_concept'],
  },
};

function getStoryTypeTemplate(storyType) {
  return STORY_TYPE_TEMPLATES[storyType] || STORY_TYPE_TEMPLATES.geopolitics_world;
}

module.exports = {
  STORY_TYPE_TEMPLATES,
  getStoryTypeTemplate,
};
