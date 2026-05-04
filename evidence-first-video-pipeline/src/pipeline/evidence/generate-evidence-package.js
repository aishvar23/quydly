'use strict';

function generateEvidencePackage(story, understanding, audit) {
  return {
    story_id: story.id,
    story_type: understanding.story_type,
    audit: {
      video_candidate: audit.video_candidate,
      video_candidate_score: audit.video_candidate_score,
      visual_angle: audit.visual_angle,
    },
    entities: understanding.entities,
    numbers: understanding.numbers,
    legal: understanding.legal,
    products_or_platforms: understanding.products_or_platforms || [],
    actions: understanding.actions || [],
    timeline_events: understanding.timeline_events,
    visual_requirements: understanding.visual_requirements || [],
    why_it_matters_concepts: understanding.why_it_matters_concepts || [],
    visual_concepts: understanding.visualizable_concepts,
    source_documents: sourceDocumentsFor(story, understanding),
    assets: assetsFor(understanding),
    visual_policy: visualPolicyFor(understanding),
    safety_notes: safetyNotesFor(understanding),
    forbidden_visuals: forbiddenVisualsFor(understanding),
  };
}

function sourceDocumentsFor(story, understanding) {
  const isVanDykeCase = understanding.entities.people.some((person) => person.name === 'Gannon Ken Van Dyke');
  if (!isVanDykeCase) {
    return [];
  }

  return [
    {
      id: 'doj_van_dyke_press_release',
      type: 'source_document',
      title: 'DOJ SDNY press release: U.S. Soldier Charged With Using Classified Information To Profit From Prediction Market Bets',
      url: 'https://www.justice.gov/usao-sdny/pr/us-soldier-charged-using-classified-information-profit-prediction-market-bets',
      source: 'U.S. Department of Justice',
      usage: 'primary factual backbone for charges, timeline, money amounts, and allegation language',
    },
    {
      id: 'doj_van_dyke_indictment',
      type: 'source_document',
      title: 'U.S. v. Van Dyke indictment PDF',
      url: 'https://www.justice.gov/usao-sdny/media/1437781/dl',
      source: 'U.S. Department of Justice',
      usage: 'exact legal-document reference; rendered as a graphic charge card, not a fake courtroom scene',
    },
  ];
}

function assetsFor(understanding) {
  const isVanDykeCase = understanding.entities.people.some((person) => person.name === 'Gannon Ken Van Dyke');
  if (!isVanDykeCase) {
    const locations = understanding.entities.locations || [];
    return {
      exact_visuals_needed: (understanding.visual_requirements || [])
        .filter((item) => item.kind === 'person' || item.kind === 'platform')
        .map((item) => ({
          id: slug(item.label),
          label: item.label,
          status: 'lookup_required',
          preferred_module: item.module,
        })),
      contextual_visuals_allowed: ['source documents', 'institutional context']
        .map((label) => ({ id: slug(label), label, condition: 'Allowed only when labeled contextual.' })),
      graphic_modules_needed: graphicsForStoryType(understanding.story_type),
      map_location_needs: locations,
      exact_available: [],
      contextual_available: [],
      maps_needed: locations,
      graphics_needed: graphicsForStoryType(understanding.story_type),
    };
  }

  return {
    exact_visuals_needed: [
      {
        id: 'van_dyke_source_document',
        label: 'U.S. v. Gannon Ken Van Dyke indictment',
        status: 'source document available',
        preferred_module: 'DossierCard',
      },
      {
        id: 'maduro_official_portrait',
        label: 'Nicolas Maduro',
        status: 'available',
        preferred_module: 'PersonCard',
      },
    ],
    contextual_visuals_allowed: [
      {
        id: 'us_special_forces_training',
        label: 'U.S. Special Forces training',
        condition: 'Allowed only when explicitly labeled contextual and never framed as the event.',
      },
    ],
    graphic_modules_needed: [
      'hook_strap',
      'source_dossier',
      'platform_card',
      'money_flow_card',
      'map_callout',
      'charge_card',
      'timeline_card',
      'why_it_matters_card',
      'outro_lockup',
    ],
    map_location_needs: ['Caracas', 'Venezuela'],
    exact_available: [
      {
        id: 'maduro_official_portrait',
        asset_class: 'exact',
        kind: 'photo',
        subject: 'Nicolas Maduro',
        source_page: 'https://commons.wikimedia.org/wiki/File:Nicol%C3%A1s_Maduro_official_portrait.png',
        file_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Nicol%C3%A1s_Maduro_official_portrait.png',
        credit: 'Presidency of Bolivarian Republic of Venezuela / Wikimedia Commons',
        license: 'Public domain in Venezuela per Wikimedia Commons file page',
        usage: 'public-figure PersonCard only',
      },
      {
        id: 'doj_van_dyke_indictment',
        asset_class: 'exact',
        kind: 'source_document',
        subject: 'U.S. v. Gannon Ken Van Dyke indictment',
        source_page: 'https://www.justice.gov/usao-sdny/pr/us-soldier-charged-using-classified-information-profit-prediction-market-bets',
        file_url: 'https://www.justice.gov/usao-sdny/media/1437781/dl',
        credit: 'U.S. Department of Justice / Southern District of New York',
        license: 'U.S. government source document',
        usage: 'source-backed dossier and charge modules',
      },
    ],
    contextual_available: [
      {
        id: 'us_special_forces_training',
        asset_class: 'contextual',
        kind: 'photo',
        subject: 'U.S. Special Forces training',
        source_page: 'https://commons.wikimedia.org/wiki/File:US_Special_Forces_soldiers_conduct_hostage_rescue_drills_in_Germany.jpg',
        file_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/US_Special_Forces_soldiers_conduct_hostage_rescue_drills_in_Germany.jpg',
        credit: 'U.S. Army / Wikimedia Commons',
        license: 'Public domain U.S. government work',
        usage: 'contextual military-service visual; never presented as event footage',
      },
    ],
    maps_needed: ['Caracas', 'Venezuela'],
    graphics_needed: [
      'hook_strap',
      'dossier_card',
      'platform_card',
      'money_flow_card',
      'map_callout',
      'charge_card',
      'timeline_card',
      'why_it_matters_card',
      'outro_lockup',
    ],
  };
}

function graphicsForStoryType(storyType) {
  const byType = {
    legal_scandal: ['hook_strap', 'dossier_card', 'number_card', 'charge_card', 'timeline_card', 'why_it_matters_card'],
    geopolitics_world: ['hook_strap', 'dossier_card', 'person_card', 'map_callout', 'timeline_card', 'why_it_matters_card'],
    finance_markets: ['hook_strap', 'number_card', 'platform_card', 'map_callout', 'why_it_matters_card'],
    tech_cyber: ['hook_strap', 'platform_card', 'diagram_card', 'number_card', 'why_it_matters_card'],
  };
  return byType[storyType] || ['hook_strap', 'dossier_card', 'number_card', 'why_it_matters_card'];
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function safetyNotesFor(understanding) {
  const base = [
    'Do not imply direct footage unless the evidence package contains an exact verified clip.',
    'Do not use synthetic portraits for named real people in sensitive legal, political, or financial stories.',
    'Prefer exact assets, labeled maps, data cards, source-document cards, and explanatory graphics over generic contextual footage.',
  ];

  if (understanding.story_type === 'legal_scandal') {
    base.push('Preserve allegation language and legal posture in visuals and narration.');
    base.push('Do not use fake arrest, courtroom, or operation footage.');
  }
  if ((understanding.products_or_platforms || []).length) {
    base.push('Use platform cards or labeled reconstructions unless an exact screenshot is licensed and verified.');
  }

  return base;
}

function forbiddenVisualsFor(understanding) {
  const forbidden = [
    'random laptop person presented as the actor in the story',
    'money piles or cash-counting filler',
    'generic crowds or buildings without story relevance',
  ];

  if (understanding.story_type === 'legal_scandal') {
    forbidden.push('fake arrest footage');
    forbidden.push('random soldier portraits presented as Van Dyke');
    forbidden.push('unverified operation footage');
  }

  return forbidden;
}

function visualPolicyFor(understanding) {
  return {
    exact_first: true,
    contextual_requires_label: true,
    graphics_preferred_when_footage_missing: true,
    required_visual_checks: (understanding.visual_requirements || []).map((item) => ({
      kind: item.kind,
      label: item.label,
      module: item.module,
      strategy: item.visual_strategy,
    })),
  };
}

module.exports = {
  generateEvidencePackage,
};
