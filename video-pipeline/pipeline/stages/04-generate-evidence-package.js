'use strict';

const fs   = require('fs');
const path = require('path');

async function run(ctx) {
  const { story, storyUnderstanding, storyId, outputDir } = ctx;

  console.log('[04-generate-evidence-package] Building evidence package...');

  const su = storyUnderstanding;

  // Determine which graphics are needed based on evidence
  const graphicsNeeded = ['dossier_card', 'outro_lockup'];
  if (su.charges.length > 0)                   graphicsNeeded.push('charge_card');
  if (su.numbers.money.length > 0)             graphicsNeeded.push('number_card_money');
  if (su.numbers.counts.length > 0)            graphicsNeeded.push('number_card_count');
  if (su.locations.length > 0)                 graphicsNeeded.push('map_callout');
  if (su.products_or_platforms.length > 0)     graphicsNeeded.push('platform_card');
  if (su.timeline_events.length >= 2)          graphicsNeeded.push('timeline_card');
  if (su.people.length > 0)                    graphicsNeeded.push('person_card');
  if (su.why_it_matters)                       graphicsNeeded.push('why_it_matters_card');

  const safetyNotes = [
    'Do not imply direct footage of the event',
    'Use contextual graphics, maps, and data cards instead of footage of named individuals',
    'Do not generate synthetic portraits of named real people',
  ];
  if (su.charges.length > 0) {
    safetyNotes.push('Charges are alleged — do not imply guilt in graphics');
  }

  const evidencePackage = {
    story_id: storyId,
    entities: {
      people:        su.people,
      organizations: su.organizations,
      locations:     su.locations,
    },
    numbers:  su.numbers,
    legal:    { charges: su.charges },
    timeline: su.timeline_events,
    platforms: su.products_or_platforms,
    visual_concepts: su.visualizable_concepts,
    assets: {
      exact_available:      [],
      contextual_available: [],
      maps_needed:          su.locations.slice(0, 2),
      graphics_needed:      [...new Set(graphicsNeeded)],
    },
    safety_notes: safetyNotes,
  };

  const outPath = path.join(outputDir, `story-${storyId}-evidence-package.json`);
  fs.writeFileSync(outPath, JSON.stringify(evidencePackage, null, 2));

  console.log(`[04-generate-evidence-package] ✓ maps_needed: ${evidencePackage.assets.maps_needed.length}, graphics_needed: ${evidencePackage.assets.graphics_needed.length}`);
  console.log(`  Graphics: ${evidencePackage.assets.graphics_needed.join(', ')}`);

  return { evidencePackage, evidencePackagePath: outPath };
}

module.exports = { run };
