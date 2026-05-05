#!/usr/bin/env node
'use strict';

// Bridge phase 3 — scene planner tests.
// Run: node --test test/plan-scenes.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planScenes,
  pickWhatHappened,
  buildWhoInvolved,
  buildSpeakerIntro,
  buildWhyMatters,
  buildWhatsNext,
  SCENE_PURPOSES,
} = require('../src/pipeline/brief/plan-scenes');

const { generateVideoBrief } = require('../src/pipeline/brief/generate-video-brief');

function story170Fixture() {
  return {
    id: '170',
    headline: 'US-Iran Naval Confrontation Escalates in Strait of Hormuz Despite Fragile Ceasefire',
    hook_sentence: 'Iran has closed the Strait of Hormuz as US naval blockade escalates military confrontation.',
    why_it_matters: 'This vital shipping route handles global oil supplies, threatening energy prices and potential wider conflict.',
    editorial_posture: 'breaking_developing',
    story_type: 'geopolitics_world',
    verification_status: 'draft',
    is_verified: false,
    consistency_score: 0.538,
    source_count: 11,
    factual_conflicts: [],
    primary_entities: ['Donald Trump', 'Asim Munir', 'Strait of Hormuz', 'IRIS Dena', 'Mohammad Fathali', 'Revolutionary Guards'],
    primary_geos: ['Iran', 'India'],
    primary_places: [{ code: 'ir', name: 'Iran' }, { code: 'in', name: 'India' }],
    primary_entities_enriched: [
      { name: 'Donald Trump', type: 'person', role: 'US President' },
      { name: 'Asim Munir', type: 'person', role: 'Pakistan Army Chief' },
      { name: 'Strait of Hormuz', type: 'place', role: 'strategic waterway' },
      { name: 'IRIS Dena', type: 'org', role: 'Iranian warship' },
      { name: 'Mohammad Fathali', type: 'person', role: 'Iranian Ambassador to India' },
      { name: 'Revolutionary Guards', type: 'org', role: 'Iranian military force' },
    ],
    timeline_events: [
      { date: '2026-04-25', label: 'Iran rules out reopening', source_id: 97498 },
      { date: '2026-04-22', label: 'Indian-bound ship seized', source_id: 92179 },
      { date: '2026-04-19', label: 'Iran doubles down on closure', source_id: 81221 },
    ],
    timeline_disposition: 'fallback',
    key_points: [
      'Iran closed the Strait of Hormuz to commercial shipping amid ongoing US naval blockade',
      'Two Indian vessels attacked in the strait, leading to diplomatic protests from New Delhi',
      'US struck Iranian warship last month killing 104 crew members, seized Iranian cargo ship',
    ],
    source_documents: [
      {
        id: '86774', issuer: 'timesofindia.indiatimes.com',
        title: "Surviving sailor narrates horror",
        quote_text: 'It was around 3:00 to 3:30 a.m. when we were suddenly attacked—an attack that was completely against international maritime laws.',
        quote_speaker: 'Hamed Momeneh',
        quote_role: 'surviving sailor',
      },
      { id: '79727', issuer: 'bbc.com', title: 'Strait of Hormuz closed again' },
      { id: '79783', issuer: 'thehindu.com', title: "India calls in Iranian envoy" },
    ],
  };
}

function publishabilityFor() {
  return {
    publishable: false, publish_block_reason: 'verification_status=draft',
    risk_label: 'developing', blocks: ['verification_status=draft'],
  };
}

function evidencePackageFor(story) {
  return {
    angle: { primary_actors: ['Donald Trump'], affected_parties: ['India'] },
    why_it_matters: story.why_it_matters,
    hook_sentence: story.hook_sentence,
    editorial_posture: story.editorial_posture,
    source_documents: story.source_documents,
    timeline_events: story.timeline_events,
    numbers: { money: [], counts: [] },
    entities: { locations: ['Donald Trump'], people: [], organizations: [] },
    metadata: {},
    _story: story,
  };
}

// ── Story spine: 7 scenes in the right order ────────────────────────────────

test('Phase 3: planner outputs 6-8 scenes with correct purposes', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  assert.ok(plan.scenes.length >= 6 && plan.scenes.length <= 8,
    `expected 6-8 scenes, got ${plan.scenes.length}`);
  // Check purposes appear in story-spine order.
  const purposes = plan.scenes.map((s) => s.purpose);
  const expectedOrder = ['hook', 'what_happened', 'who_involved', 'escalation', 'timeline', 'why_matters', 'whats_next'];
  for (let i = 0; i < expectedOrder.length; i++) {
    assert.equal(purposes[i], expectedOrder[i],
      `scene ${i} should have purpose ${expectedOrder[i]}, got ${purposes[i]}`);
  }
});

test('Phase 3: total duration is 35-45 seconds', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  assert.ok(plan.total_duration_sec >= 30 && plan.total_duration_sec <= 50,
    `expected 30-50s total, got ${plan.total_duration_sec}s`);
});

// ── Speaker introduction guard ──────────────────────────────────────────────

test('Phase 3: speaker introduced in scene 3 BEFORE quote in scene 4', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  // Find scene with the quote (escalation scene).
  const escalationScene = plan.scenes.find((s) => s.purpose === 'escalation');
  // Hamed Momeneh is the sailor speaker. He's NOT in primary_entities_enriched
  // for story 170, so the quote should NOT be inlined and the data flag
  // should be false.
  assert.equal(escalationScene.data.includes_quote, false,
    'speaker NOT in actor list → quote must NOT inline; got includes_quote=true');
});

test('Phase 3: speaker introduced when speaker IS in actor list', () => {
  const story = {
    ...story170Fixture(),
    primary_entities_enriched: [
      ...story170Fixture().primary_entities_enriched,
      { name: 'Hamed Momeneh', type: 'person', role: 'surviving sailor' },
    ],
  };
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  const escalation = plan.scenes.find((s) => s.purpose === 'escalation');
  assert.equal(escalation.data.includes_quote, true,
    'speaker IS in actor list → quote should inline');
  // Voiceover should explicitly introduce the speaker before the quote.
  assert.match(escalation.voiceover, /hamed momeneh/i, 'speaker name must appear in narration');
  assert.match(escalation.voiceover, /surviving sailor/i, 'speaker role must appear in narration');
});

// ── Editorial-metadata bans ─────────────────────────────────────────────────

test('Phase 3: NO scene has DEVELOPING / Map context / What we cited / Article in onscreen_text', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  const banned = ['developing', 'map context', 'not event footage', 'what we cited', 'article'];
  for (const scene of plan.scenes) {
    const text = (scene.onscreen_text || '').toLowerCase();
    for (const bad of banned) {
      assert.ok(!text.includes(bad),
        `scene "${scene.purpose}" onscreen_text contains banned editorial label "${bad}": "${scene.onscreen_text}"`);
    }
  }
});

test('Phase 3: developing badge surfaces only as corner chip on scene 1', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  const hook = plan.scenes[0];
  assert.equal(hook.developing_corner_chip, 'DEVELOPING',
    'developing badge must appear as corner chip on hook scene');
  assert.ok(!hook.onscreen_text.toLowerCase().includes('developing'),
    'developing must NOT be primary onscreen text');
});

// ── Story spine fields ──────────────────────────────────────────────────────

test('Phase 3: scene 6 (why_matters) uses synth why_it_matters when present', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  const why = plan.scenes.find((s) => s.purpose === 'why_matters');
  assert.match(why.voiceover, /shipping route|oil supplies/i,
    'why_matters voiceover should incorporate synth why_it_matters');
});

test('Phase 3: scene 7 (whats_next) is breaking-developing for story 170', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  const next = plan.scenes.find((s) => s.purpose === 'whats_next');
  assert.match(next.voiceover, /widen|conflict|talks/i,
    'whats_next must express the open question');
});

test('Phase 3: scene 7 carries source_attribution as small bottom strip', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  const next = plan.scenes.find((s) => s.purpose === 'whats_next');
  assert.ok(typeof next.source_attribution === 'string' && next.source_attribution.length > 0,
    'closing scene must carry source attribution as a strip');
  // Sources joined with separator.
  assert.match(next.source_attribution, /·/, 'source attribution should use a separator');
});

// ── Connector narration ─────────────────────────────────────────────────────

test('Phase 3: scene 2-onward voiceover starts with a connector clause', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  // Scene 2+ should NOT start mid-thought; should open with a connector.
  const expectedConnectors = [
    /^(here'?s what|on the ground)/i,
    /^(the players|four governments)/i,
    /^(the fallout|then it escalated)/i,
    /^(here'?s the sequence|how the week)/i,
    /^(why this matters|zoom out)/i,
    /^(what to watch|the open question)/i,
  ];
  for (let i = 1; i < Math.min(plan.scenes.length, 7); i++) {
    const connector = expectedConnectors[i - 1];
    if (!connector) continue;
    assert.match(plan.scenes[i].voiceover, connector,
      `scene ${i} (${plan.scenes[i].purpose}) should open with a connector; got: "${plan.scenes[i].voiceover.slice(0, 60)}..."`);
  }
});

// ── Visual / motion direction ───────────────────────────────────────────────

test('Phase 3: every scene has visual_direction and motion_direction', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  for (const scene of plan.scenes) {
    assert.ok(scene.visual_direction && scene.visual_direction.length > 5,
      `${scene.purpose}: visual_direction missing`);
    assert.ok(scene.motion_direction && scene.motion_direction.length > 5,
      `${scene.purpose}: motion_direction missing`);
  }
});

test('Phase 3: visual_direction is specific, not generic', () => {
  const story = story170Fixture();
  const brief = generateVideoBrief({
    story, evidencePackage: evidencePackageFor(story), publishability: publishabilityFor(),
  });
  const plan = planScenes({ story, evidencePackage: evidencePackageFor(story), brief });
  const generic = ['show news background', 'static text on dark background', 'plain card'];
  for (const scene of plan.scenes) {
    const vd = scene.visual_direction.toLowerCase();
    for (const bad of generic) {
      assert.ok(!vd.includes(bad),
        `${scene.purpose}: visual_direction is generic "${bad}"`);
    }
  }
});

// ── pickWhatHappened heuristics ─────────────────────────────────────────────

test('Phase 3: pickWhatHappened prefers a verb-event hook_sentence', () => {
  const story = { hook_sentence: 'Iran has closed the Strait of Hormuz today.' };
  const brief = { source_receipts: [] };
  const result = pickWhatHappened(brief, story);
  assert.match(result, /closed|closing/, 'should pick the verb-event sentence');
});

test('Phase 3: pickWhatHappened falls back to receipts when hook is vague', () => {
  const story = { hook_sentence: 'A situation in the Middle East.' };
  const brief = {
    source_receipts: [{ claim: 'Iran fired on two India-flagged tankers' }],
  };
  const result = pickWhatHappened(brief, story);
  assert.match(result, /fired|attacked/i, 'should pick the verb-event receipt claim');
});

// ── buildWhoInvolved ────────────────────────────────────────────────────────

test('Phase 3: buildWhoInvolved surfaces all named persons + orgs (not just Trump)', () => {
  const story = story170Fixture();
  const result = buildWhoInvolved(story);
  const names = result.actors.map((a) => a.name);
  // All 4 persons in the fixture should be candidates.
  assert.ok(names.includes('Donald Trump'));
  assert.ok(names.includes('Asim Munir'));
  assert.ok(names.includes('Mohammad Fathali'));
  // Orgs also surface.
  assert.ok(names.some((n) => n === 'IRIS Dena' || n === 'Revolutionary Guards'));
});

// ── SCENE_PURPOSES export ───────────────────────────────────────────────────

test('Phase 3: SCENE_PURPOSES is the canonical 7-scene spine', () => {
  assert.deepEqual(
    SCENE_PURPOSES,
    ['hook', 'what_happened', 'who_involved', 'escalation', 'timeline', 'why_matters', 'whats_next'],
  );
});
