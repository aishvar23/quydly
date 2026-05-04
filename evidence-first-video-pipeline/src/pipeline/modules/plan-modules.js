'use strict';

const { MODULE_TYPES } = require('./module-types');
const { getStoryTypeTemplate } = require('./story-type-templates');

function planModules({ story, evidencePackage, script, voice }) {
  const storyTemplate = getStoryTypeTemplate(evidencePackage.story_type);
  const template = buildTemplateModules(story, evidencePackage, script, storyTemplate);
  const timedTemplate = applyVoiceTimings(template, script, voice);
  const narrationDuration = Math.max(voice.totalDurationSec || 0, script.estimated_duration_sec || 42);
  const totalHint = timedTemplate.filter((module) => module.role !== 'outro')
    .reduce((sum, module) => sum + module.durationHintSec, 0);
  const scale = totalHint > 0 ? narrationDuration / totalHint : 1;
  let cursor = 0;

  const modules = timedTemplate.map((module, index) => {
    const isOutro = module.role === 'outro';
    const hasExactTiming = Number.isFinite(module.startSec) && Number.isFinite(module.durationSec);
    const startSec = hasExactTiming ? module.startSec : cursor;
    const durationSec = hasExactTiming
      ? module.durationSec
      : isOutro
        ? 3.4
        : clamp(module.durationHintSec * scale, module.minDurationSec || 3.4, module.maxDurationSec || 7.2);
    const planned = {
      moduleId: index + 1,
      role: module.role,
      componentType: module.componentType,
      startSec: round(startSec),
      durationSec: round(durationSec),
      endSec: round(startSec + durationSec),
      overlayText: module.overlayText,
      narration: module.narration || '',
      assetClass: module.assetClass || 'graphic',
      assetNeed: module.assetNeed || null,
      data: {
        ...(module.data || {}),
        visualRequirement: findRequirement(evidencePackage, module.role, module.componentType),
      },
      asset: {
        kind: module.assetClass || 'graphic',
        src: null,
        safetyClass: module.assetClass || 'graphic',
      },
    };
    cursor = Math.max(cursor, startSec + durationSec);
    return planned;
  });

  return {
    story_id: story.id,
    story_type: evidencePackage.story_type,
    template: storyTemplate.id,
    visual_priority: storyTemplate.visualPriority,
    modules,
    totalDurationSec: round(cursor),
  };
}

function applyVoiceTimings(template, script, voice) {
  const segmentTimings = buildSegmentTimings(script, voice);
  if (!Object.keys(segmentTimings).length) return template;

  const narratedModules = template
    .filter((module) => module.role !== 'outro' && segmentTimings[module.role])
    .map((module) => ({
      role: module.role,
      ...segmentTimings[module.role],
    }))
    .sort((a, b) => a.startSec - b.startSec);

  if (!narratedModules.length) return template;

  const lastVoiceEnd = Math.max(
    voice.totalDurationSec || 0,
    ...narratedModules.map((module) => module.endSec)
  );
  const outroStart = lastVoiceEnd + 0.45;

  return template.map((module) => {
    if (module.role === 'outro') {
      return {
        ...module,
        startSec: outroStart,
        durationSec: Math.max(module.durationHintSec || 3.4, 3.6),
      };
    }

    const timing = segmentTimings[module.role];
    if (!timing) return module;
    const nextTiming = narratedModules.find((item) => item.startSec > timing.startSec + 0.001);
    const segmentEnd = timing.endSec + 0.25;
    const nextStart = nextTiming ? nextTiming.startSec : outroStart;
    return {
      ...module,
      startSec: timing.startSec,
      durationSec: Math.max(1.2, nextStart - timing.startSec, segmentEnd - timing.startSec),
    };
  });
}

function buildSegmentTimings(script, voice) {
  const alignment = voice?.alignment;
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  if (!starts.length || !ends.length || !script?.full_script || !Array.isArray(script.segments)) {
    return {};
  }

  const timings = {};
  let cursor = 0;
  for (const segment of script.segments) {
    const text = segment.text || '';
    const startIndex = script.full_script.indexOf(text, cursor);
    if (startIndex < 0) continue;
    const endIndex = startIndex + text.length - 1;
    const startSec = findNearestTime(starts, startIndex, 'forward');
    const endSec = findNearestTime(ends, endIndex, 'backward');
    if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec >= startSec) {
      timings[segment.role] = {
        startSec,
        endSec,
      };
    }
    cursor = startIndex + text.length;
  }
  return timings;
}

function findNearestTime(times, index, direction) {
  if (Number.isFinite(times[index])) return times[index];
  const step = direction === 'forward' ? 1 : -1;
  for (let offset = 1; offset < 20; offset++) {
    const value = times[index + offset * step];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function buildTemplateModules(story, evidencePackage, script, storyTemplate) {
  if (isVanDykeCase(evidencePackage)) {
    return legalScandalTemplate(evidencePackage, script);
  }
  return genericTemplate(story, evidencePackage, script, storyTemplate);
}

function isVanDykeCase(evidencePackage) {
  return (evidencePackage.entities.people || []).some((person) => person.name === 'Gannon Ken Van Dyke');
}

function legalScandalTemplate(evidencePackage, script) {
  const segments = indexSegments(script.segments || []);
  const people = evidencePackage.entities.people || [];
  const subject = people.find((person) => person.name === 'Gannon Ken Van Dyke') || people[0] || {};
  const maduro = people.find((person) => person.name === 'Nicolas Maduro') || {};
  const money = evidencePackage.numbers.money || [];
  const charges = evidencePackage.legal.charges || [];

  return [
    {
      role: 'hook',
      componentType: MODULE_TYPES.HOOK_STRAP,
      overlayText: '$409K from secret intel?',
      narration: segment(segments, 'hook'),
      durationHintSec: 3.6,
      minDurationSec: 3.4,
      maxDurationSec: 5.0,
      data: {
        kicker: 'FEDERAL INDICTMENT',
        headline: '$409K from secret intel?',
        subhead: 'The allegation: classified access became a prediction-market edge.',
      },
    },
    {
      role: 'dossier',
      componentType: MODULE_TYPES.DOSSIER_CARD,
      overlayText: 'Source-backed case file',
      narration: segment(segments, 'dossier'),
      durationHintSec: 5.2,
      data: {
        caseLabel: 'SOURCE-BACKED CASE FILE',
        subject: subject.name || 'Named subject',
        role: subject.role || 'reported subject',
        status: 'Indictment allegations only',
        chips: ['U.S. Army', 'Fort Bragg', 'DOJ / SDNY', 'Classified access'],
        note: 'No licensed exact portrait used',
        sourceTitle: 'U.S. v. Gannon Ken Van Dyke',
        sourceMeta: 'Southern District of New York - unsealed Apr. 23, 2026',
        evidenceRows: [
          ['Defendant', subject.name || 'Gannon Ken Van Dyke'],
          ['Status', 'charged by indictment'],
          ['Alleged edge', 'confidential government information'],
          ['Platform', 'Polymarket'],
        ],
      },
    },
    {
      role: 'person_context',
      componentType: MODULE_TYPES.PERSON_CARD,
      overlayText: 'Maduro operation context',
      narration: segment(segments, 'person_context'),
      durationHintSec: 4.4,
      assetClass: 'exact',
      assetNeed: { assetId: 'maduro_official_portrait' },
      data: {
        name: maduro.name || 'Nicolas Maduro',
        role: maduro.role || 'former Venezuelan president',
        affiliation: maduro.affiliation || 'Venezuela',
        label: 'Exact public-domain portrait',
      },
    },
    {
      role: 'platform',
      componentType: MODULE_TYPES.PLATFORM_CARD,
      overlayText: 'Polymarket bets',
      narration: segment(segments, 'platform'),
      durationHintSec: 4.8,
      data: {
        platform: 'Polymarket',
        market: 'Maduro out by Jan. 31',
        side: 'YES',
        detail: 'Graphic reconstruction of the alleged market position, not a screenshot.',
        chips: ['13 wagers', 'Maduro-linked market', 'account deletion request'],
      },
    },
    {
      role: 'numbers',
      componentType: MODULE_TYPES.NUMBER_CARD,
      overlayText: '$33,034 to $409,881',
      narration: segment(segments, 'numbers'),
      durationHintSec: 5.0,
      data: {
        primary: pickMoney(money, 'alleged profit') || '$409,881',
        secondary: pickMoney(money, 'alleged amount staked') || '$33,034',
        count: '13',
        label: 'alleged wagers',
        flowLabel: 'staked -> alleged profit',
      },
    },
    {
      role: 'map',
      componentType: MODULE_TYPES.MAP_CALLOUT,
      overlayText: 'Caracas, Venezuela',
      narration: segment(segments, 'map'),
      durationHintSec: 4.5,
      assetClass: 'map',
      assetNeed: { geoLocation: 'Caracas' },
      data: {
        location: 'Caracas',
        country: 'Venezuela',
        context: 'Location context only - not operation footage.',
      },
    },
    {
      role: 'charges',
      componentType: MODULE_TYPES.CHARGE_CARD,
      overlayText: 'Five federal counts',
      narration: segment(segments, 'charges'),
      durationHintSec: 5.4,
      data: {
        authority: 'Southern District of New York',
        posture: evidencePackage.legal.posture,
        sourceTitle: 'Indictment counts',
        charges,
      },
    },
    {
      role: 'timeline',
      componentType: MODULE_TYPES.TIMELINE_CARD,
      overlayText: 'Dec. 26 to Apr. 23',
      narration: segment(segments, 'timeline'),
      durationHintSec: 5.2,
      data: {
        events: evidencePackage.timeline_events,
      },
    },
    {
      role: 'impact',
      componentType: MODULE_TYPES.WHY_IT_MATTERS_CARD,
      overlayText: 'Prediction-market risk',
      narration: segment(segments, 'impact'),
      durationHintSec: 4.8,
      data: {
        statement: 'The alleged edge was not a better forecast. It was classified access.',
        support: 'That turns an event market into a market-integrity problem.',
        relationship: ['classified access', 'market edge', 'federal charges'],
      },
    },
    {
      role: 'outro',
      componentType: MODULE_TYPES.OUTRO_LOCKUP,
      overlayText: 'Quydly',
      durationHintSec: 3.4,
      data: {
        line: 'Know the story. Keep the receipts.',
      },
    },
  ];
}

function genericTemplate(story, evidencePackage, script, storyTemplate) {
  const segments = indexSegments(script.segments || []);
  const requirements = evidencePackage.visual_requirements || [];
  const firstPerson = firstRequirement(requirements, 'person');
  const firstPlace = firstRequirement(requirements, 'place');
  const firstMoney = firstRequirement(requirements, 'money') || firstRequirement(requirements, 'number');
  const firstPlatform = firstRequirement(requirements, 'platform');
  const concept = firstRequirement(requirements, 'concept') || firstRequirement(requirements, 'legal');
  const firstOrg = (evidencePackage.entities.organizations || [])[0] || null;
  const personNames = uniqueLabels([
    ...requirements.filter((item) => item.kind === 'person').map((item) => item.label),
    ...(evidencePackage.entities.people || []).map((person) => person.name),
  ]).slice(0, 2);
  const charges = evidencePackage.legal.charges || [];
  const timelineEvents = evidencePackage.timeline_events || [];
  const sequence = filteredSequence(storyTemplate.moduleSequence, {
    firstPerson,
    firstPlace,
    firstMoney,
    firstPlatform,
    charges,
    timelineEvents,
    storyType: evidencePackage.story_type,
  });

  return sequence.map((componentType, index) => {
    if (componentType === MODULE_TYPES.HOOK_STRAP) {
      return {
        role: 'hook',
        componentType,
        overlayText: short(story.headline, 5),
        narration: segment(segments, 'hook') || story.headline,
        durationHintSec: 4,
        data: {
          kicker: storyTemplate.label,
          headline: short(story.headline, 7),
          subhead: '',
        },
      };
    }
    if (componentType === MODULE_TYPES.PERSON_CARD) {
      const personName = firstPerson?.label || firstOrg || 'Key actor';
      const peopleForCard = personNames.length ? personNames : [personName].filter(Boolean);
      return {
        role: 'person_context',
        componentType,
        overlayText: peopleForCard.join(' / ') || personName,
        narration: segment(segments, 'person_context'),
        durationHintSec: 5,
        assetClass: firstPerson ? 'exact' : 'graphic',
        assetNeed: firstPerson
          ? peopleForCard.length > 1
            ? { people: peopleForCard }
            : { personName: peopleForCard[0] || personName }
          : null,
        data: {
          name: peopleForCard.join(' / ') || personName,
          people: peopleForCard,
          role: firstPerson
            ? peopleForCard.length > 1
              ? 'named people in the story'
              : 'named person'
            : 'institution or group',
          affiliation: '',
          label: firstPerson
            ? peopleForCard.length > 1
              ? 'Exact person visuals'
              : 'Exact person visual'
            : 'Entity context',
        },
      };
    }
    if (componentType === MODULE_TYPES.MAP_CALLOUT) {
      return {
        role: 'map',
        componentType,
        overlayText: firstPlace?.label || 'Map context',
        narration: segment(segments, 'map'),
        durationHintSec: 5,
        assetClass: firstPlace ? 'map' : 'graphic',
        assetNeed: firstPlace ? { geoLocation: firstPlace.label } : null,
        data: {
          location: firstPlace?.label || 'Location',
          country: '',
          context: 'Location context',
        },
      };
    }
    if (componentType === MODULE_TYPES.NUMBER_CARD) {
      const countValue = firstNumberDisplay(evidencePackage) || '1';
      return {
        role: 'numbers',
        componentType,
        overlayText: firstMoney?.label || 'Key number',
        narration: segment(segments, 'numbers'),
        durationHintSec: 5,
        data: {
          primary: firstMoney?.label || 'Key number',
          secondary: 'reported case',
          primaryLabel: 'reported figure',
          secondaryLabel: 'context',
          count: countValue,
          label: 'key point',
          flowLabel: 'reported metric',
        },
      };
    }
    if (componentType === MODULE_TYPES.PLATFORM_CARD) {
      return {
        role: 'platform',
        componentType,
        overlayText: firstPlatform?.label || 'Platform context',
        narration: segment(segments, 'platform'),
        durationHintSec: 5,
        data: {
          platform: firstPlatform?.label || 'Platform',
          market: story.headline,
          detail: 'Platform or product context from story understanding.',
          chips: evidencePackage.products_or_platforms || [],
          displayMode: 'context',
        },
      };
    }
    if (componentType === MODULE_TYPES.CHARGE_CARD) {
      return {
        role: 'charges',
        componentType,
        overlayText: charges[0] || 'Legal posture',
        narration: segment(segments, 'charges'),
        durationHintSec: 5,
        data: {
          authority: evidencePackage.story_type === 'legal_scandal' ? 'Legal posture' : 'Reported claims',
          title: evidencePackage.story_type === 'legal_scandal' ? 'Legal claims' : 'Key claims',
          posture: evidencePackage.legal.posture,
          charges: charges.length ? charges : fallbackClaims(story, evidencePackage),
        },
      };
    }
    if (componentType === MODULE_TYPES.TIMELINE_CARD) {
      return {
        role: 'timeline',
        componentType,
        overlayText: 'Timeline',
        narration: segment(segments, 'timeline'),
        durationHintSec: 5,
        data: {
          title: timelineEvents.length ? 'Key developments' : 'What is known',
          events: timelineEvents.length ? timelineEvents : fallbackEvents(story),
        },
      };
    }
    if (componentType === MODULE_TYPES.WHY_IT_MATTERS_CARD) {
      return {
        role: 'impact',
        componentType,
        overlayText: 'Why it matters',
        narration: segment(segments, 'impact') || story.summary,
        durationHintSec: 5,
        data: {
          statement: whyStatement(evidencePackage),
          support: evidencePackage.why_it_matters_concepts?.[0] || story.summary,
          relationship: evidencePackage.why_it_matters_concepts?.slice(0, 3) || [],
        },
      };
    }
    if (componentType === MODULE_TYPES.DOSSIER_CARD) {
      return {
        role: 'dossier',
        componentType,
        overlayText: 'Story dossier',
        narration: segment(segments, 'dossier'),
        durationHintSec: 5,
        data: {
          caseLabel: storyTemplate.label,
          subject: dossierSubject(story, evidencePackage),
          role: segment(segments, 'dossier') || short(story.summary, 34),
          status: 'Reported facts only',
          chips: [],
          evidenceRows: [],
        },
      };
    }
    return {
      role: index === sequence.length - 1 ? 'outro' : 'impact',
      componentType: MODULE_TYPES.OUTRO_LOCKUP,
      overlayText: 'Quydly',
      durationHintSec: 3.4,
      data: { line: 'Know the story. Keep the receipts.' },
    };
  });
}

function filteredSequence(sequence, context) {
  const result = sequence.filter((componentType) => {
    if (componentType === MODULE_TYPES.PLATFORM_CARD) return Boolean(context.firstPlatform);
    if (componentType === MODULE_TYPES.NUMBER_CARD) return Boolean(context.firstMoney);
    if (componentType === MODULE_TYPES.MAP_CALLOUT) {
      return Boolean(context.firstPlace) || context.storyType === 'geopolitics_world';
    }
    if (componentType === MODULE_TYPES.PERSON_CARD) return Boolean(context.firstPerson);
    if (componentType === MODULE_TYPES.CHARGE_CARD) {
      return context.storyType === 'legal_scandal' || context.charges.length > 0;
    }
    return true;
  });

  if (context.firstMoney && !result.includes(MODULE_TYPES.NUMBER_CARD)) {
    const mapIndex = result.indexOf(MODULE_TYPES.MAP_CALLOUT);
    const impactIndex = result.indexOf(MODULE_TYPES.WHY_IT_MATTERS_CARD);
    const insertIndex = mapIndex >= 0 ? mapIndex : impactIndex >= 0 ? impactIndex : Math.max(1, result.length - 1);
    result.splice(insertIndex, 0, MODULE_TYPES.NUMBER_CARD);
  }
  if (!result.includes(MODULE_TYPES.WHY_IT_MATTERS_CARD)) {
    result.splice(Math.max(1, result.length - 1), 0, MODULE_TYPES.WHY_IT_MATTERS_CARD);
  }
  if (result[result.length - 1] !== MODULE_TYPES.OUTRO_LOCKUP) {
    result.push(MODULE_TYPES.OUTRO_LOCKUP);
  }
  return result;
}

function fallbackClaims(story, evidencePackage) {
  const claims = [
    ...(evidencePackage.actions || []),
    ...(story.key_points || []),
  ].filter(Boolean).slice(0, 4);
  return claims.length ? claims : ['reported dispute'];
}

function fallbackEvents(story) {
  const points = (story.key_points || []).slice(0, 4);
  if (!points.length) {
    return [{ label: 'Reported story', detail: story.summary || story.headline }];
  }
  return points.map((point, index) => ({
    label: index === 0 ? 'Main detail' : `Detail ${index + 1}`,
    detail: point,
  }));
}

function firstNumberDisplay(evidencePackage) {
  const count = (evidencePackage.numbers.counts || [])[0];
  if (!count) return null;
  const match = String(count.display || '').match(/\d[\d,]*/);
  return match ? match[0].replace(/,/g, '') : null;
}

function dossierSubject(story, evidencePackage) {
  const people = (evidencePackage.entities.people || []).map((person) => person.name);
  const orgs = evidencePackage.entities.organizations || [];
  const locations = evidencePackage.entities.locations || [];
  const parts = [...people.slice(0, 2), ...orgs.slice(0, 1), ...locations.slice(0, 1)]
    .filter(Boolean)
    .slice(0, 3);
  return parts.length ? parts.join(' / ') : short(story.headline, 8);
}

function whyStatement(evidencePackage) {
  const concepts = evidencePackage.why_it_matters_concepts || [];
  if (concepts[0] && concepts[1]) return `${sentenceCase(concepts[0])} meets ${concepts[1]}`;
  if (concepts[0]) return sentenceCase(concepts[0]);
  return 'What changes next';
}

function sentenceCase(value) {
  const text = String(value || '').replace(/_/g, ' ');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : '';
}

function findRequirement(evidencePackage, role, componentType) {
  const requirements = evidencePackage.visual_requirements || [];
  const exactModule = requirements.find((item) => item.module === componentType);
  if (exactModule) return exactModule;
  return requirements.find((item) => roleMatchesRequirement(role, item.kind)) || null;
}

function roleMatchesRequirement(role, kind) {
  const pairs = {
    person_context: 'person',
    platform: 'platform',
    numbers: 'money',
    map: 'place',
    charges: 'legal',
    impact: 'concept',
  };
  return pairs[role] === kind || (role === 'numbers' && kind === 'number');
}

function firstRequirement(requirements, kind) {
  return requirements.find((item) => item.kind === kind) || null;
}

function uniqueLabels(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const label = String(value || '').trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function indexSegments(segments) {
  return segments.reduce((result, item) => {
    result[item.role] = item.text;
    return result;
  }, {});
}

function segment(segments, role) {
  return segments[role] || '';
}

function pickMoney(items, roleFragment) {
  const found = items.find((item) => String(item.role || '').includes(roleFragment));
  return found ? found.display : null;
}

function short(value, maxWords) {
  return String(value || '').split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(value.toFixed(3));
}

module.exports = {
  planModules,
};
