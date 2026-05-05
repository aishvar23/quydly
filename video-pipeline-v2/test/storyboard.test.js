#!/usr/bin/env node
'use strict';

// Bridge phase 4 — storyboard + validator tests.
// Run: node --test test/storyboard.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHormuzStoryboard,
  SHOT_TYPES,
  pickFourCountries,
  pickIndiaImpactClaim,
} = require('../src/pipeline/storyboard/generate-storyboard');
const {
  validateStoryboard,
  BANNED_LABELS,
} = require('../src/pipeline/storyboard/validate-storyboard');

// ── Fixtures ────────────────────────────────────────────────────────────────

function story170Fixture() {
  return {
    id: '170',
    headline: 'US-Iran Naval Confrontation Escalates in Strait of Hormuz Despite Fragile Ceasefire',
    hook_sentence: 'Iran has closed the Strait of Hormuz as US naval blockade escalates military confrontation.',
    why_it_matters: 'This vital shipping route handles global oil supplies, threatening energy prices and potential wider conflict.',
    editorial_posture: 'breaking_developing',
    story_type: 'geopolitics_world',
    primary_places: [
      { code: 'us', name: 'United States' },
      { code: 'ir', name: 'Iran' },
      { code: 'in', name: 'India' },
      { code: 'pk', name: 'Pakistan' },
    ],
    timeline_events: [
      { date: '2026-04-18', label: 'Strait closure reported', source_id: 79727 },
      { date: '2026-04-18', label: 'India protests vessel attacks', source_id: 79783 },
      { date: '2026-04-19', label: 'Iran doubles down', source_id: 81221 },
      { date: '2026-04-20', label: 'Pakistan raises blockade concern', source_id: 86434 },
    ],
    timeline_disposition: 'multi_day',
    key_points: [
      'Two Indian vessels attacked in the strait, leading to diplomatic protests from New Delhi',
      "Pakistan's military leadership urged Trump to end blockade as obstacle to peace talks",
    ],
  };
}

function briefFixture() {
  return {
    risk_label: 'developing',
    developing_badge: 'DEVELOPING',
    source_receipts: [
      { source: 'BBC',           claim: 'Strait closed again' },
      { source: 'The Hindu',     claim: 'Two Indian vessels attacked in the strait' },
      { source: 'ABC News',      claim: 'Iran doubles down on closure' },
      { source: 'Indian Express', claim: "Pakistan urged Trump to end blockade" },
    ],
    timeline_events: [
      { date: '2026-04-18', label: 'Strait closure reported' },
      { date: '2026-04-18', label: 'India protests vessel attacks' },
      { date: '2026-04-19', label: 'Iran doubles down' },
      { date: '2026-04-20', label: 'Pakistan raises blockade concern' },
    ],
  };
}

// ── Storyboard generator ────────────────────────────────────────────────────

test('Phase 4: Hormuz storyboard has exactly 8 scenes in user-specified order', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  assert.equal(sb.scenes.length, 8);
  const purposes = sb.scenes.map((s) => s.purpose);
  assert.deepEqual(purposes, [
    'global_stakes_hook',
    'what_happened',
    'who_involved',
    'india_impact',
    'pakistan_diplomacy',
    'timeline_build',
    'why_matters',
    'what_to_watch',
  ]);
});

test('Phase 4: total duration ~44s (within 35-50)', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  assert.ok(sb.total_duration_sec >= 35 && sb.total_duration_sec <= 50,
    `got ${sb.total_duration_sec}s`);
});

test('Phase 4: scene 1 onscreen text is the global-stakes hook', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  assert.equal(sb.scenes[0].onscreen_text, 'A major oil route is at risk');
  assert.equal(sb.scenes[0].visual.shot_type, SHOT_TYPES.GLOBE_ZOOM);
});

test('Phase 4: scene 3 surfaces all four countries with roles', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  const scene3 = sb.scenes[2];
  assert.equal(scene3.purpose, 'who_involved');
  assert.equal(scene3.visual.shot_type, SHOT_TYPES.FOUR_COUNTRY_FLAGS);
  const codes = scene3.visual.elements.map((e) => e.country);
  assert.deepEqual(codes, ['us', 'ir', 'in', 'pk']);
  // Roles present and balanced.
  const roles = scene3.visual.elements.map((e) => e.role);
  assert.ok(roles.includes('blockade'));
  assert.ok(roles.includes('strait closure'));
  assert.ok(roles.includes('vessels affected'));
  assert.ok(roles.includes('diplomacy'));
});

test('Phase 4: Pakistan diplomacy scene has balanced portrait pair (no Trump dominance)', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  const scene5 = sb.scenes[4];
  assert.equal(scene5.purpose, 'pakistan_diplomacy');
  const balanced = scene5.visual.elements.find((e) => e.kind === 'balanced_portrait_pair');
  assert.ok(balanced, 'pakistan_diplomacy must have balanced_portrait_pair element');
  assert.deepEqual(balanced.countries, ['us', 'pk']);
  // No Trump-only portrait.
  const portraits = scene5.visual.elements.filter((e) => e?.kind === 'portrait');
  for (const p of portraits) {
    assert.ok(!/trump/i.test(p?.subject || ''), 'no Trump-only portrait allowed');
  }
});

test('Phase 4: timeline scene has meaningful labels (no "Article")', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  const tl = sb.scenes[5];
  const events = tl.visual.elements.filter((e) => e.kind === 'timeline_event');
  assert.ok(events.length >= 3);
  for (const e of events) {
    assert.notEqual(e.label.toLowerCase(), 'article');
    assert.ok(e.label.length > 5, `meaningful label required: "${e.label}"`);
  }
});

test('Phase 4: scene 8 carries source attribution as small strip — not a full scene', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  const last = sb.scenes[sb.scenes.length - 1];
  assert.equal(last.purpose, 'what_to_watch');
  assert.ok(typeof last.source_attribution === 'string' && last.source_attribution.includes('·'));
  // No scene with purpose === 'citations' / 'evidence_shelf' / 'sources'.
  const purposes = sb.scenes.map((s) => s.purpose);
  for (const banned of ['citations', 'evidence_shelf', 'sources', 'receipts']) {
    assert.ok(!purposes.includes(banned), `no scene may have purpose "${banned}"`);
  }
});

test('Phase 4: every scene has motion.during so static cards never play > 2s', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  for (const scene of sb.scenes) {
    assert.ok(scene.motion?.during && scene.motion.during.length > 5,
      `${scene.purpose}: motion.during missing`);
  }
});

test('Phase 4: sources_metadata is present (for description), no scene has full citation', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  assert.ok(Array.isArray(sb.sources_metadata) && sb.sources_metadata.length > 0,
    'sources_metadata must carry the source list');
});

// ── Validator: hard-fail rules ──────────────────────────────────────────────

test('Phase 4 validator: trailing-zero text fails', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  // Tamper: produce the actual NumberCard bug shape.
  sb.scenes[6].onscreen_text = 'Why this matters0';
  const result = validateStoryboard(sb);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.rule === 'trailing_zero'),
    `expected trailing_zero error; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
});

test('Phase 4 validator: repeated opening fails', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  sb.scenes[1].onscreen_text = sb.scenes[0].onscreen_text;
  const result = validateStoryboard(sb);
  assert.ok(result.errors.some((e) => e.rule === 'repeated_opening'),
    `expected repeated_opening error; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
});

test('Phase 4 validator: Iran-vs-India framing fails', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  sb.scenes[2].onscreen_text = 'Iran vs India';
  const result = validateStoryboard(sb);
  assert.ok(result.errors.some((e) => e.rule === 'wrong_frame'),
    `expected wrong_frame error; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
});

test('Phase 4 validator: banned editorial labels fail', () => {
  for (const bad of ['Article', 'Map context', 'What we cited', 'Receipts', 'Developing']) {
    const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
    sb.scenes[1].onscreen_text = bad;
    const result = validateStoryboard(sb);
    assert.ok(result.errors.some((e) => e.rule === 'banned_label'),
      `expected banned_label fail for "${bad}"; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
  }
});

test('Phase 4 validator: generic timeline labels fail', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  const tl = sb.scenes[5];
  // Replace the first event label with "Article".
  const target = tl.visual.elements.find((e) => e.kind === 'timeline_event');
  target.label = 'Article';
  const result = validateStoryboard(sb);
  assert.ok(result.errors.some((e) => e.rule === 'generic_timeline'),
    `expected generic_timeline error; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
});

test('Phase 4 validator: shot_type without renderer support fails (ALL current shots fail)', () => {
  // Phase 4 ships the planner + validator but no renderer
  // components for the new shot_types. The validator MUST refuse
  // every storyboard until Phase 5 builds the components. This
  // prevents shipping a render that silently degrades to a
  // generic dark-grid card.
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  const result = validateStoryboard(sb);
  assert.equal(result.ok, false, 'Phase 4 storyboards must hard-fail until Phase 5 components ship');
  assert.ok(result.errors.some((e) => e.rule === 'shot_type_unsupported'),
    `expected shot_type_unsupported errors; got: ${JSON.stringify(result.errors.map((e) => e.rule).slice(0, 5))}`);
});

test('Phase 4 validator: citations-as-full-scene fails', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  // Inject a citations scene.
  sb.scenes.splice(7, 0, {
    scene_number: 99,
    purpose: 'citations',
    duration_sec: 5,
    onscreen_text: 'Sources cited',
    voiceover: 'Reporting from BBC, The Hindu, ABC News, Indian Express.',
    visual: { shot_type: 'evidence_shelf', elements: [] },
    motion: { during: 'list reveal' },
  });
  const result = validateStoryboard(sb);
  assert.ok(result.errors.some((e) => e.rule === 'citation_full_scene'),
    `expected citation_full_scene error; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
});

test('Phase 4 validator: missing motion.during fails', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  sb.scenes[1].motion = { in: 'fade in', during: '', out: '' };
  const result = validateStoryboard(sb);
  assert.ok(result.errors.some((e) => e.rule === 'static_no_motion'),
    `expected static_no_motion error; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
});

test('Phase 4 validator: first-3-scenes-unclear fails when event verb missing', () => {
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  // Wipe event verbs from first 3 scenes.
  for (let i = 0; i < 3; i++) {
    sb.scenes[i].onscreen_text = 'Story';
    sb.scenes[i].voiceover = 'A situation.';
  }
  const result = validateStoryboard(sb);
  assert.ok(result.errors.some((e) => e.rule === 'unclear_first_three'),
    `expected unclear_first_three error; got: ${JSON.stringify(result.errors.map((e) => e.rule))}`);
});

test('Phase 4 validator: helpful summary on real Hormuz storyboard', () => {
  // The fresh Hormuz storyboard should fail ONLY on shot_type_unsupported
  // (because no renderer components exist). All editorial / structural
  // rules must pass.
  const sb = buildHormuzStoryboard({ story: story170Fixture(), brief: briefFixture() });
  const result = validateStoryboard(sb);
  assert.equal(result.ok, false, 'expected hard-fail until Phase 5 components ship');
  const ruleSet = new Set(result.errors.map((e) => e.rule));
  // Editorial rules must all pass.
  for (const editorialRule of [
    'trailing_zero', 'repeated_opening', 'wrong_frame', 'banned_label',
    'onscreen_too_long', 'missing_voiceover', 'missing_shot_type',
    'static_no_motion', 'citation_full_scene', 'generic_timeline',
    'quote_before_speaker', 'unclear_first_three',
  ]) {
    assert.ok(!ruleSet.has(editorialRule),
      `editorial rule ${editorialRule} should pass on the fresh storyboard; got errors: ${JSON.stringify([...ruleSet])}`);
  }
  // The ONLY error should be shot_type_unsupported (× 8 scenes).
  for (const err of result.errors) {
    assert.equal(err.rule, 'shot_type_unsupported',
      `unexpected rule fired: ${err.rule} — ${err.detail}`);
  }
});

// ── Helper exports ──────────────────────────────────────────────────────────

test('Phase 4: pickFourCountries always returns the canonical four', () => {
  // Even with empty primary_places, the four-country structure is
  // editorially anchored — confirmed_by_synth flags emphasis only.
  const four = pickFourCountries({ primary_places: [] });
  assert.equal(four.length, 4);
  assert.deepEqual(four.map((c) => c.code), ['us', 'ir', 'in', 'pk']);
});

test('Phase 4: pickIndiaImpactClaim picks an India-vessel claim', () => {
  const claim = pickIndiaImpactClaim(briefFixture(), story170Fixture());
  assert.match(claim, /india.*vessel|indian.*vessel|two indian/i);
});
