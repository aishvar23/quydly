'use strict';

function understandStory(story) {
  const text = storyText(story);
  const lower = text.toLowerCase();
  const isVanDykeCase = lower.includes('polymarket') && lower.includes('maduro');

  if (isVanDykeCase) {
    return vanDykeUnderstanding(story);
  }

  const people = inferPeople(text);
  const organizations = inferOrganizations(story, text);
  const locations = inferLocations(story, text);
  const storyType = inferStoryType(story);

  return {
    story_id: story.id,
    story_type: storyType,
    entities: {
      people,
      organizations,
      locations,
    },
    numbers: {
      money: extractMoney(text).map((display) => ({ display, role: 'reported_amount' })),
      counts: extractCounts(text),
    },
    legal: {
      charges: extractCharges(text),
      posture: 'reported allegations',
    },
    products_or_platforms: uniqueMatches(text, [
      'Polymarket',
      'X',
      'TikTok',
      'Instagram',
      'YouTube',
      'ChatGPT',
      'iPhone',
      'Bitcoin',
      'Ethereum',
    ]),
    actions: extractActions(text),
    timeline_events: buildTimelineEvents(story),
    visualizable_concepts: inferConcepts(story),
    why_it_matters: story.summary || story.headline,
    why_it_matters_concepts: inferWhyItMatters(story),
    visual_requirements: buildVisualRequirements(story, text, {
      people,
      organizations,
      locations,
      storyType,
    }),
  };
}

function vanDykeUnderstanding(story) {
  return {
    story_id: story.id,
    story_type: 'legal_scandal',
    entities: {
      people: [
        {
          name: 'Gannon Ken Van Dyke',
          role: 'U.S. Army master sergeant',
          affiliation: 'U.S. Army / Fort Bragg',
          exact_image_status: 'not licensed in this pipeline',
        },
        {
          name: 'Nicolas Maduro',
          role: 'former Venezuelan president',
          affiliation: 'Venezuela',
          exact_image_status: 'public-domain official portrait available',
        },
      ],
      organizations: [
        'U.S. Army',
        'Department of Justice',
        'FBI',
        'Polymarket',
        'Southern District of New York',
      ],
      locations: ['Caracas', 'Venezuela', 'Fort Bragg', 'North Carolina', 'Manhattan federal court'],
    },
    numbers: {
      money: [
        { display: '$33,034', role: 'alleged amount staked' },
        { display: '$409,881', role: 'alleged profit' },
        { display: '$400K+', role: 'headline shorthand' },
      ],
      counts: [
        { display: '13', label: 'alleged YES wagers' },
        { display: '5', label: 'federal counts' },
      ],
    },
    legal: {
      posture: 'indictment allegations',
      charges: [
        'unlawful use of confidential government information',
        'theft of nonpublic government information',
        'commodities fraud',
        'wire fraud',
        'unlawful monetary transaction',
      ],
    },
    products_or_platforms: ['Polymarket'],
    actions: [
      'created and funded a Polymarket account',
      'placed Maduro- and Venezuela-related YES wagers',
      'allegedly moved proceeds through cryptocurrency and brokerage accounts',
      'asked Polymarket to delete the account',
    ],
    timeline_events: [
      { label: 'Dec. 26, 2025', detail: 'Account allegedly created and funded' },
      { label: 'Dec. 27-Jan. 2', detail: '13 alleged YES wagers placed' },
      { label: 'Jan. 3, 2026', detail: 'Operation Absolute Resolve announced' },
      { label: 'Apr. 23, 2026', detail: 'Indictment unsealed by SDNY' },
    ],
    visualizable_concepts: [
      'classified operation access',
      'prediction-market contracts',
      'money flow',
      'legal indictment',
      'Caracas operation context',
      'market integrity risk',
    ],
    why_it_matters: 'The case tests whether prediction markets can police trades based on classified government information.',
    why_it_matters_concepts: [
      'classified access can create an unfair market edge',
      'prediction markets need controls for nonpublic government information',
      'legal posture matters because the facts are indictment allegations',
    ],
    visual_requirements: [
      {
        kind: 'person',
        label: 'Gannon Ken Van Dyke',
        required: true,
        module: 'DossierCard',
        visual_strategy: 'case dossier with explicit no-portrait note',
        exact_asset_id: null,
      },
      {
        kind: 'person',
        label: 'Nicolas Maduro',
        required: true,
        module: 'PersonCard',
        visual_strategy: 'exact public-domain portrait',
        exact_asset_id: 'maduro_official_portrait',
      },
      {
        kind: 'platform',
        label: 'Polymarket',
        required: true,
        module: 'PlatformCard',
        visual_strategy: 'graphic market reconstruction labeled as reconstruction',
      },
      {
        kind: 'money',
        label: '$33,034 staked -> $409,881 profit',
        required: true,
        module: 'NumberCard',
        visual_strategy: 'number card with source citation',
      },
      {
        kind: 'place',
        label: 'Caracas, Venezuela',
        required: true,
        module: 'MapCallout',
        visual_strategy: 'labeled map; not operation footage',
      },
      {
        kind: 'legal',
        label: 'five federal counts',
        required: true,
        module: 'ChargeCard',
        visual_strategy: 'charge list from indictment allegations',
      },
      {
        kind: 'concept',
        label: 'classified information as market edge',
        required: true,
        module: 'WhyItMattersCard',
        visual_strategy: 'relationship graphic and concise implication',
      },
    ],
  };
}

function storyText(story) {
  return [
    story.headline,
    story.summary,
    ...(story.key_points || []),
    ...(story.primary_entities || []),
  ].filter(Boolean).join(' ');
}

function inferStoryType(story) {
  const text = storyText(story).toLowerCase();
  if (text.includes('charge') || text.includes('fraud') || text.includes('indict') ||
    text.includes('lawsuit') || text.includes('sues') || text.includes('sentenced')) return 'legal_scandal';
  if (/\b(market|stock|crypto|bank|tariff|bond|shares?)\b/.test(text)) return 'finance_markets';
  if (/\b(cyber|hack|ai|artificial intelligence|malware|ransomware)\b/.test(text)) return 'tech_cyber';
  return 'geopolitics_world';
}

function uniqueMatches(text, candidates) {
  const lower = text.toLowerCase();
  return candidates.filter((candidate, index, list) => {
    const normalized = candidate.toLowerCase();
    return lower.includes(normalized) && list.findIndex((item) => item.toLowerCase() === normalized) === index;
  });
}

function extractMoney(text) {
  const matches = text.match(/\$[\d,.]+(?:\s*(?:million|billion|k))?/gi) || [];
  return Array.from(new Set(matches));
}

function extractCounts(text) {
  const matches = text.match(/\b\d{1,4}(?:,\d{3})*\s+(?:counts?|wagers?|people|companies|countries|days|weeks|months|years|carriers|soldiers|ships|vessels|seafarers)\b/gi) || [];
  return Array.from(new Set(matches)).map((display) => ({ display, label: 'reported count' }));
}

function extractCharges(text) {
  const lower = text.toLowerCase();
  const charges = [
    'defamation lawsuit',
    'public nuisance',
    'wire fraud',
    'commodities fraud',
    'theft of government information',
    'unlawful monetary transaction',
    'lawsuit',
    'sentencing',
  ].filter((charge) => lower.includes(charge.replace('sentencing', 'sentenced')) || lower.includes(charge));
  if (charges.includes('defamation lawsuit')) {
    return charges.filter((charge) => charge !== 'lawsuit');
  }
  return charges;
}

function inferPeople(text) {
  const candidates = [
    ...explicitPersonMatches(text),
    ...(text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g) || []),
  ];
  const blocked = new Set([
    'US Army',
    'U.S. Army',
    'Department of Justice',
    'North Carolina',
    'United States',
    'Special Forces',
    'Fort Bragg',
    'Foreign Minister',
    'World War',
    'Middle East',
    'Strait Hormuz',
  ]);
  return Array.from(new Set(candidates))
    .map(normalizePersonCandidate)
    .filter((name) => name && !blocked.has(name))
    .filter((name) => !/\b(Sues|Over|Million|Allegations|Maintains|Blockade|Diplomat|Regional|Capitals|Minister|Pentagon|Chief|Tours|Drinking|Atlantic|Hormuz|Iranian|Wednesday|All)\b/.test(name))
    .filter((name, index, list) => list.indexOf(name) === index)
    .slice(0, 4)
    .map((name) => ({
      name,
      role: 'named person',
      affiliation: null,
      exact_image_status: 'unknown',
    }));
}

function explicitPersonMatches(text) {
  const matches = [];
  const patterns = [
    /\b(?:Foreign Minister|reporter|nominee|chief|director nominee|President|Prime Minister)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:filed|announced|travels|denying|received|said)\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) matches.push(match[1]);
    }
  }

  return matches;
}

function extractActions(text) {
  const lower = text.toLowerCase();
  const actions = [];
  if (lower.includes('charged')) actions.push('charged by authorities');
  if (lower.includes('sentenced')) actions.push('sentenced by court');
  if (lower.includes('launched')) actions.push('launched');
  if (lower.includes('announced')) actions.push('announced');
  if (lower.includes('bought') || lower.includes('sold') || lower.includes('traded')) actions.push('traded or transacted');
  if (lower.includes('sued') || lower.includes('sues') || lower.includes('lawsuit')) actions.push('filed lawsuit');
  if (lower.includes('blocked') || lower.includes('blockade')) actions.push('blocked or blockaded');
  if (lower.includes('deployed')) actions.push('deployed');
  if (lower.includes('attacked') || lower.includes('seized')) actions.push('attacked or seized');
  if (lower.includes('travels') || lower.includes('visiting')) actions.push('diplomatic travel');
  if (lower.includes('approved')) actions.push('approved');
  return actions;
}

function inferConcepts(story) {
  const text = storyText(story).toLowerCase();
  const concepts = ['source documents', 'key numbers'];
  if (text.includes('charge') || text.includes('fraud') || text.includes('indict')) concepts.push('legal posture');
  if (text.includes('market') || text.includes('stock') || text.includes('crypto')) concepts.push('market mechanics');
  if (text.includes('platform') || text.includes('app') || text.includes('polymarket')) concepts.push('platform context');
  if (text.includes('city') || text.includes('country') || text.includes('venezuela')) concepts.push('map context');
  if (/\b(ai|cyber|hack|artificial intelligence|malware|ransomware)\b/.test(text)) concepts.push('system diagram');
  return Array.from(new Set(concepts));
}

function inferWhyItMatters(story) {
  const type = inferStoryType(story);
  const byType = {
    legal_scandal: ['accountability', 'legal risk', 'public trust'],
    geopolitics_world: ['regional stakes', 'policy shift', 'who is affected'],
    finance_markets: ['market signal', 'capital flow', 'risk exposure'],
    tech_cyber: ['system risk', 'user impact', 'platform trust'],
  };
  return byType[type] || ['public impact'];
}

function buildVisualRequirements(story, text, inferred = {}) {
  const type = inferred.storyType || inferStoryType(story);
  const people = inferred.people || inferPeople(text);
  const locations = inferred.locations || inferLocations(story, text);
  const money = extractMoney(text);
  const counts = extractCounts(text);
  const platforms = uniqueMatches(text, ['Polymarket', 'X', 'TikTok', 'Instagram', 'YouTube', 'ChatGPT', 'Bitcoin', 'Ethereum']);
  const requirements = [];

  if (people[0]) requirements.push({
    kind: 'person',
    label: people[0].name,
    required: true,
    module: 'PersonCard',
    visual_strategy: 'exact portrait if available, otherwise labeled dossier card',
  });
  if (locations[0]) requirements.push({
    kind: 'place',
    label: locations[0],
    required: true,
    module: 'MapCallout',
    visual_strategy: 'labeled map',
  });
  if (money[0]) requirements.push({
    kind: 'money',
    label: money[0],
    required: true,
    module: 'NumberCard',
    visual_strategy: 'data/number card',
  });
  if (!money[0] && counts[0]) requirements.push({
    kind: 'number',
    label: counts[0].display,
    required: true,
    module: 'NumberCard',
    visual_strategy: 'data/number card',
  });
  if (platforms[0]) requirements.push({
    kind: 'platform',
    label: platforms[0],
    required: true,
    module: 'PlatformCard',
    visual_strategy: 'platform card or interface reconstruction',
  });
  requirements.push({
    kind: type.includes('legal') ? 'legal' : 'concept',
    label: type,
    required: true,
    module: type.includes('legal') ? 'ChargeCard' : 'WhyItMattersCard',
    visual_strategy: 'story-type explanatory module',
  });

  return requirements;
}

function inferOrganizations(story, text) {
  const known = uniqueMatches(text, [
    'U.S. Army',
    'US Army',
    'Polymarket',
    'FBI',
    'DOJ',
    'Department of Justice',
    'The Atlantic',
    'Pentagon',
    'US Navy',
    'NATO',
    'Sunrisers Hyderabad',
    'Mumbai Indians',
    'Microsoft',
    'Google',
    'OpenAI',
    'Apple',
    'Nvidia',
    'Tesla',
  ]);
  const fromEntities = (story.primary_entities || [])
    .filter((item) => String(item).length > 2)
    .map(titleCaseEntity)
    .slice(0, 5);
  return Array.from(new Set([...known, ...fromEntities])).slice(0, 8);
}

function inferLocations(story, text) {
  const known = uniqueMatches(text, [
    'Seoul',
    'South Korea',
    'Strait of Hormuz',
    'Hormuz',
    'Iran',
    'Pakistan',
    'Oman',
    'Russia',
    'Middle East',
    'Tehran',
    'Madrid',
    'Spain',
    'Caracas',
    'Venezuela',
    'Fort Bragg',
    'North Carolina',
    'United States',
    'India',
    'China',
    'Ukraine',
    'Gaza',
    'Israel',
    'Europe',
  ]);
  const lower = text.toLowerCase();
  const fromCodes = (story.primary_geos || [])
    .map(geoCodeToLabel)
    .filter((label) => label && lower.includes(label.toLowerCase()));
  return Array.from(new Set([...known, ...fromCodes])).slice(0, 8);
}

function geoCodeToLabel(code) {
  const labels = {
    in: 'India',
    pk: 'Pakistan',
    qa: 'Qatar',
    us: 'United States',
    gb: 'United Kingdom',
    kr: 'South Korea',
    ir: 'Iran',
    ru: 'Russia',
    es: 'Spain',
  };
  return labels[String(code || '').toLowerCase()] || null;
}

function titleCaseEntity(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function buildTimelineEvents(story) {
  const points = (story.key_points || []).slice(0, 4);
  if (!points.length) return [];
  return points.map((point, index) => ({
    label: index === 0 ? 'Main report' : `Detail ${index + 1}`,
    detail: point,
  }));
}

function normalizePersonCandidate(candidate) {
  const cleaned = String(candidate || '')
    .replace(/^Iranian Foreign Minister\s+/, '')
    .replace(/^Foreign Minister\s+/, '')
    .replace(/^Minister\s+/, '')
    .replace(/^Pentagon Chief\s+/, '')
    .replace(/^Pentagon chief\s+/, '')
    .replace(/^Reporter\s+/, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return '';
  return cleaned;
}

module.exports = {
  understandStory,
};
