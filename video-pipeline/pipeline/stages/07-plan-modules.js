'use strict';

const fs   = require('fs');
const path = require('path');
const { getTemplate } = require('../../lib/story-type-templates');

const OUTRO_DUR = 4.0;

async function run(ctx) {
  const { storyUnderstanding, evidencePackage, script, storyType, totalDuration, storyId, outputDir } = ctx;

  console.log(`[07-plan-modules] Building module plan for story type: ${storyType}`);

  const modulePlan = buildModulePlan(storyType, storyUnderstanding, evidencePackage, script, totalDuration);

  modulePlan.forEach(m => {
    const dur = m.durationSec.toFixed(2);
    console.log(`  Module ${m.moduleId}: [${m.moduleType}] ${m.startSec.toFixed(2)}s–${m.endSec.toFixed(2)}s (${dur}s)`);
  });

  const planPath = path.join(outputDir, `story-${storyId}-module-plan.json`);
  fs.writeFileSync(planPath, JSON.stringify(modulePlan, null, 2));

  console.log(`[07-plan-modules] ✓ ${modulePlan.length} modules planned`);
  return { modulePlan, modulePlanPath: planPath };
}

function buildModulePlan(storyType, su, ep, script, totalDuration) {
  const template   = getTemplate(storyType);
  const narrations = script.module_narrations;

  // Distribute narration duration proportionally by word count
  const narModules = narrations.filter(m => m.narration && m.narration.trim());
  const totalWords = narModules.reduce((sum, m) => sum + m.narration.trim().split(/\s+/).filter(Boolean).length, 0) || 1;
  const narDuration = Math.max((totalDuration || 42) - OUTRO_DUR, 20);

  let cursor = 0;
  return template.modules.map((tmpl, i) => {
    const narEntry  = narrations[i];
    const narration = narEntry?.narration?.trim() || '';
    const isOutro   = tmpl.type === 'OutroLockup';

    let durationSec;
    if (isOutro) {
      durationSec = OUTRO_DUR;
    } else {
      const words = narration.split(/\s+/).filter(Boolean).length;
      durationSec = Math.max(parseFloat(((words / totalWords) * narDuration).toFixed(2)), 3.0);
    }

    const startSec = isOutro
      ? parseFloat(Math.max(cursor, narDuration).toFixed(3))
      : parseFloat(cursor.toFixed(3));
    const endSec = parseFloat((startSec + durationSec).toFixed(3));

    if (!isOutro) cursor += durationSec;

    const base = {
      moduleId:         i + 1,
      moduleType:       tmpl.type,
      startSec,
      endSec,
      durationSec:      parseFloat(durationSec.toFixed(3)),
      narrationSegment: narration,
    };

    return { ...base, ...resolveModuleProps(tmpl.type, su, ep, script) };
  });
}

function resolveModuleProps(moduleType, su, ep, script) {
  switch (moduleType) {
    case 'HookStrap':
      return {
        hookText: script.hook || su.actions[0] || '',
        eyebrow:  'BREAKING',
      };

    case 'PersonCard': {
      const personStr = su.people[0] || '';
      const parenIdx  = personStr.indexOf('(');
      const name      = parenIdx > -1 ? personStr.slice(0, parenIdx).trim() : personStr.trim();
      const role      = parenIdx > -1 ? personStr.slice(parenIdx + 1).replace(/\)$/, '').trim() : 'Person of interest';
      return {
        name,
        role,
        affiliation: su.organizations[0] || '',
        imageSrc:    null,
      };
    }

    case 'DossierCard':
      return {
        caseTitle:       ep.entities.organizations[0]
          ? `${ep.entities.organizations[0]} Case`
          : 'Case File',
        subject:         su.people[0]?.split('(')[0]?.trim() || 'Unknown Subject',
        chips:           [
          ...ep.entities.organizations.slice(0, 1),
          ...ep.entities.locations.slice(0, 1),
          ...(ep.legal.charges.length > 0 ? ['CHARGES FILED'] : []),
        ].filter(Boolean).slice(0, 3),
        category:        'LEGAL',
        dossierLocation: ep.entities.locations[0] || '',
      };

    case 'NumberCard': {
      const money = ep.numbers.money[0] || null;
      const count = ep.numbers.counts[0] || null;
      if (money) {
        const parts = money.split(' ');
        return {
          mainNumber:      parts[0].toUpperCase(),
          numberLabel:     parts.slice(1).join(' ').toUpperCase() || 'IN QUESTION',
          secondaryMetric: count || null,
        };
      }
      if (count) {
        const parts = count.split(' ');
        return {
          mainNumber:      parts[0],
          numberLabel:     parts.slice(1).join(' ').toUpperCase() || 'COUNT',
          secondaryMetric: null,
        };
      }
      return { mainNumber: '—', numberLabel: '', secondaryMetric: null };
    }

    case 'MapCallout':
      return {
        locationLabel: ep.entities.locations[0]?.toUpperCase() || 'LOCATION',
        mapSrc:        null,  // filled by 09-resolve-assets
        contextNote:   ep.entities.locations[1] || null,
      };

    case 'ChargeCard':
      return {
        charges:       ep.legal.charges.slice(0, 4),
        authorityLabel: ep.entities.organizations.find(o =>
          /department|justice|doj|fbi|sec|cftc|prosecutor|attorney/i.test(o)
        ) || 'FEDERAL CHARGES',
      };

    case 'TimelineCard':
      return {
        beats: su.timeline_events.slice(0, 4).map(e => ({
          label: e.label || 'EVENT',
          text:  e.text  || '',
        })),
      };

    case 'PlatformCard': {
      const platform = su.products_or_platforms[0] || ep.entities.organizations[0] || 'Platform';
      return {
        platformName:        platform,
        platformDescription: su.actions[0] || `${platform} is central to this story`,
      };
    }

    case 'WhyItMattersCard':
      return {
        implicationText:  su.why_it_matters || 'This story has significant implications.',
        supportingPhrase: su.visualizable_concepts.slice(0, 2).join(' · ') || '',
      };

    case 'OutroLockup':
      return {};

    default:
      return {};
  }
}

module.exports = { run };
