#!/usr/bin/env node
'use strict';

// Bridge phase 2 — video_brief tests.
//
// Run: node --test test/video-brief.test.js
//
// Covers the five Codex-required scenarios:
//   1. Long opening headline gets rewritten into a short hook (≤ 7 words)
//   2. Timeline event labels are meaningful (no "Article" placeholders)
//   3. Trump card is rejected when Trump is not the primary story frame
//   4. Source cards are reduced to source + claim
//   5. DEVELOPING label appears for unverified/draft stories

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateVideoBrief,
  tightenToWords,
  buildHookOnscreen,
  dedupKeyPoints,
  shortenForTimelineLabel,
  buildTimelineEvents,
  buildSourceReceipts,
  pickDossierSubject,
  readableIssuer,
} = require('../src/pipeline/brief/generate-video-brief');

const {
  validateVideoBrief,
  ONSCREEN_MAX_WORDS,
} = require('../src/pipeline/brief/validate-video-brief');

// ── Fixture: story 170 shape (Iran/Hormuz) ───────────────────────────────────

function story170Fixture() {
  return {
    id: '170',
    headline: 'US-Iran Naval Confrontation Escalates in Strait of Hormuz Despite Fragile Ceasefire',
    summary: 'Iran shut the Strait of Hormuz...',
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
    timeline_events: [],
    timeline_disposition: 'fallback',
    key_points: [
      'Iran closed the Strait of Hormuz to commercial shipping amid ongoing US naval blockade',
      'Two Indian vessels attacked in the strait, leading to diplomatic protests from New Delhi',
      'US struck Iranian warship last month killing 104 crew members, seized Iranian cargo ship',
      "Pakistan's military leadership urged Trump to end blockade as obstacle to peace talks",
      'Iran refuses to reopen strategic waterway until US lifts naval blockade',
      'Iran closed Strait of Hormuz to commercial traffic and is targeting ships that approach',
      'US naval blockade of Iranian ports continues despite extended ceasefire agreement',
      'Two Indian vessels attacked in strait, leading India to formally protest to Iran',
      "Pakistan's army chief warned Trump that port blockade hinders peace negotiations",
      'Nine-week US-Iran conflict shows no signs of resolution despite diplomatic efforts',
    ],
    source_documents: [
      { id: '79727', issuer: 'bbc.com', title: 'Strait of Hormuz closed again, Iran says, as ships attacked', url: 'https://bbc.com/x' },
      { id: '79783', issuer: 'thehindu.com', title: "India 'calls in' Iranian envoy", url: 'https://thehindu.com/x' },
      { id: '81221', issuer: 'abcnews.go.com', title: 'Iran doubles down on closing the Strait of Hormuz', url: 'https://abcnews.go.com/x' },
      { id: '84052', issuer: 'indianexpress.com', title: "Trump says Iran 'got a little cute' with Hormuz", url: 'https://indianexpress.com/a' },
      { id: '95299', issuer: 'indianexpress.com', title: 'Two India-flagged ships fired at in Strait of Hormuz', url: 'https://indianexpress.com/b' },
    ],
  };
}

function publishabilityForStory170() {
  return {
    publishable: false,
    publish_block_reason: 'verification_status=draft',
    risk_label: 'developing',
    blocks: ['verification_status=draft', 'consistency_score=0.538'],
  };
}

function evidenceForStory170() {
  return {
    angle: { primary_actors: ['Donald Trump', 'Asim Munir', 'Mohammad Fathali'], affected_parties: [] },
    why_it_matters: 'This vital shipping route handles global oil supplies, threatening energy prices and potential wider conflict.',
    hook_sentence: 'Iran has closed the Strait of Hormuz as US naval blockade escalates military confrontation.',
    editorial_posture: 'breaking_developing',
    source_documents: story170Fixture().source_documents,
    timeline_events: [],
    numbers: { money: [], counts: [] },
    entities: { locations: ['Donald Trump', 'Asim Munir'], people: [], organizations: [] },
    metadata: {},
  };
}

// ── 1. Long opening headline gets rewritten into a short hook ───────────────

test('Phase 2: long opening headline rewritten to ≤ 7 words', () => {
  const story = story170Fixture();
  const onscreen = buildHookOnscreen(story);
  const words = onscreen.trim().split(/\s+/).length;
  assert.ok(words <= ONSCREEN_MAX_WORDS, `expected ≤ 7 words, got ${words}: "${onscreen}"`);
  // For story 170 specifically the closure-pattern shortcut should
  // produce something like "Hormuz is closing again."
  assert.match(onscreen.toLowerCase(), /hormuz/, 'hook must name the place');
  assert.match(onscreen.toLowerCase(), /closing|closed/, 'hook must name the event');
});

test('Phase 2: tightenToWords keeps complete content tail', () => {
  // Should not end on "and", "the", "of", "to", etc.
  const result = tightenToWords('Iran has closed the Strait of Hormuz as US naval blockade escalates military confrontation today', 7);
  const lastWord = result.trim().split(/\s+/).pop().toLowerCase();
  assert.ok(
    !['and', 'the', 'of', 'to', 'is', 'as', 'a', 'an'].includes(lastWord),
    `tightener must not leave a connector tail; got "${result}" (last: ${lastWord})`,
  );
});

test('Phase 2: tightenToWords no-op when already short', () => {
  assert.equal(tightenToWords('Hormuz closes again', 7), 'Hormuz closes again');
});

// ── 2. Timeline event labels are meaningful ─────────────────────────────────

test('Phase 2: timeline labels are meaningful (no "Article" placeholders)', () => {
  const story = story170Fixture();
  const events = buildTimelineEvents(story);
  assert.ok(events.length >= 2, 'should produce at least 2 timeline events');
  for (const e of events) {
    assert.notEqual(e.label.toLowerCase(), 'article', `label must not be "Article": ${JSON.stringify(e)}`);
    assert.ok(e.label.length > 5, `label must be substantive: "${e.label}"`);
  }
  // Labels should be drawn from key_points (story 170 timeline_disposition=fallback).
  const joined = events.map((e) => e.label.toLowerCase()).join(' | ');
  assert.match(joined, /strait|vessel|blockade|hormuz|warship|trump|peace|protest/i,
    `labels must reflect actual events; got: ${joined}`);
});

test('Phase 2: timeline rejects empty/whitespace labels', () => {
  const story = { ...story170Fixture(), key_points: ['', '   ', null, 42] };
  const events = buildTimelineEvents(story);
  assert.equal(events.length, 0, 'no usable key_points → no events');
});

// ── 3. Trump card rejected when Trump is not the primary story frame ────────

test('Phase 2: Trump-on-screen rejected when not primary frame', () => {
  // Synthesise a brief where one scene mistakenly has Trump on-screen.
  const brief = {
    risk_label: 'developing',
    developing_badge: 'DEVELOPING',
    story_type: 'geopolitics_world',
    angle: { primary_actors: ['Iran', 'United States'] },
    hook: { onscreen_text: 'Hormuz is closing again' },
    scenes: [
      { purpose: 'hook', onscreen_text: 'Hormuz is closing', voiceover: 'Hormuz...', visual_direction: 'map zoom into the Persian Gulf', motion_direction: 'zoom' },
      // Bad: Trump on-screen, but Trump is not primary actor.
      { purpose: 'diplomacy', onscreen_text: 'Trump under pressure', voiceover: '...', visual_direction: 'card with text', motion_direction: 'fade' },
    ],
    timeline_events: [{ label: 'Strait closed' }],
    source_receipts: [{ source: 'BBC', claim: 'Strait closed again' }],
  };
  const result = validateVideoBrief(brief);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /trump/i.test(e) && /primary/i.test(e)),
    `expected Trump-not-primary error; got: ${JSON.stringify(result.errors)}`,
  );
});

test('Phase 2: Trump on-screen accepted when story IS legal_scandal about Trump', () => {
  const brief = {
    risk_label: 'verified',
    developing_badge: null,
    story_type: 'legal_scandal',
    angle: { primary_actors: ['Donald Trump', 'Department of Justice'] },
    hook: { onscreen_text: 'Trump indictment' },
    scenes: [
      { purpose: 'hook', onscreen_text: 'Trump indictment', voiceover: 'A grand jury...', visual_direction: 'documents stack revealed', motion_direction: 'cards stagger in' },
    ],
    timeline_events: [{ label: 'Indictment unsealed' }],
    source_receipts: [{ source: 'NYT', claim: 'Indictment unsealed' }],
  };
  const result = validateVideoBrief(brief);
  // Should have NO Trump-not-primary error specifically.
  assert.equal(result.errors.filter((e) => /trump/i.test(e)).length, 0,
    `Trump should be allowed when primary_actors[0] is Trump; got: ${JSON.stringify(result.errors)}`);
});

test('Phase 2: pickDossierSubject returns null when ≥ 2 named persons in geopolitics', () => {
  // Story 170: Trump + Munir + Fathali → no dossier subject.
  const subject = pickDossierSubject(story170Fixture());
  assert.equal(subject, null, 'multiple persons in geopolitics → no single subject');
});

test('Phase 2: pickDossierSubject returns subject for single-person legal_scandal', () => {
  const story = {
    story_type: 'legal_scandal',
    primary_entities_enriched: [
      { name: 'Sam Bankman-Fried', type: 'person', role: 'defendant' },
      { name: 'Department of Justice', type: 'org', role: 'prosecutor' },
    ],
  };
  const subject = pickDossierSubject(story);
  assert.equal(subject?.name, 'Sam Bankman-Fried');
});

// ── 4. Source cards reduced to source + claim ───────────────────────────────

test('Phase 2: source receipts compressed to {source, claim}', () => {
  const story = story170Fixture();
  const receipts = buildSourceReceipts(story);
  assert.ok(receipts.length > 0, 'must produce at least one receipt');
  assert.ok(receipts.length <= 6, 'capped at 6 receipts');
  for (const r of receipts) {
    assert.ok(typeof r.source === 'string' && r.source.length > 0, `receipt missing source: ${JSON.stringify(r)}`);
    assert.ok(typeof r.claim === 'string' && r.claim.length > 0, `receipt missing claim: ${JSON.stringify(r)}`);
    // Claim should be SHORT (not a full article headline).
    assert.ok(r.claim.split(/\s+/).length <= 10, `claim too long: "${r.claim}"`);
  }
});

test('Phase 2: source receipts dedupe by issuer (one per outlet)', () => {
  // Story 170 has 2 indianexpress.com docs; should collapse to one receipt.
  const story = story170Fixture();
  const receipts = buildSourceReceipts(story);
  const sourceLabels = receipts.map((r) => r.source);
  const unique = new Set(sourceLabels);
  assert.equal(sourceLabels.length, unique.size, `duplicate source labels: ${JSON.stringify(sourceLabels)}`);
});

test('Phase 2: readableIssuer produces clean labels for known outlets', () => {
  assert.equal(readableIssuer('bbc.com'), 'BBC');
  assert.equal(readableIssuer('thehindu.com'), 'The Hindu');
  assert.equal(readableIssuer('timesofindia.indiatimes.com'), 'Times of India');
  assert.equal(readableIssuer('indianexpress.com'), 'Indian Express');
});

// ── 5. DEVELOPING label appears for unverified/draft stories ────────────────

test('Phase 2: developing_badge="DEVELOPING" for unverified story', () => {
  const brief = generateVideoBrief({
    story: story170Fixture(),
    evidencePackage: evidenceForStory170(),
    publishability: publishabilityForStory170(),
  });
  assert.equal(brief.risk_label, 'developing');
  assert.equal(brief.developing_badge, 'DEVELOPING');
  assert.equal(brief.publishable, false);
});

test('Phase 2: developing_badge=null for verified story', () => {
  const story = { ...story170Fixture(), verification_status: 'verified', is_verified: true, consistency_score: 0.9, factual_conflicts: [] };
  const brief = generateVideoBrief({
    story,
    evidencePackage: evidenceForStory170(),
    publishability: { publishable: true, publish_block_reason: null, risk_label: 'verified', blocks: [] },
  });
  assert.equal(brief.developing_badge, null);
  assert.equal(brief.publishable, true);
});

test('Phase 2: validator FAILS when brief has developing risk but no badge', () => {
  const brief = generateVideoBrief({
    story: story170Fixture(),
    evidencePackage: evidenceForStory170(),
    publishability: publishabilityForStory170(),
  });
  // Tamper: nuke the badge.
  brief.developing_badge = null;
  const result = validateVideoBrief(brief);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /developing_badge/.test(e)),
    `expected developing_badge error; got: ${JSON.stringify(result.errors)}`,
  );
});

// ── Validator: structural rules ──────────────────────────────────────────────

test('Phase 2: validator rejects onscreen_text > 7 words', () => {
  const brief = generateVideoBrief({
    story: story170Fixture(),
    evidencePackage: evidenceForStory170(),
    publishability: publishabilityForStory170(),
  });
  // Tamper: stuff a long onscreen_text.
  brief.scenes[0].onscreen_text = 'This is a very long onscreen text that exceeds seven words';
  const result = validateVideoBrief(brief);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /exceeds 7 words/.test(e)),
    `expected ≤ 7-word error; got: ${JSON.stringify(result.errors)}`,
  );
});

test('Phase 2: validator rejects "Article"-style timeline labels', () => {
  const brief = generateVideoBrief({
    story: story170Fixture(),
    evidencePackage: evidenceForStory170(),
    publishability: publishabilityForStory170(),
  });
  brief.timeline_events = [
    { date: '2026-04-18', label: 'Article' },
    { date: '2026-04-19', label: 'Article' },
  ];
  const result = validateVideoBrief(brief);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /timeline_events.*generic/.test(e)),
    `expected generic-label error; got: ${JSON.stringify(result.errors)}`,
  );
});

test('Phase 2: dedup collapses near-duplicate key_points', () => {
  const dupes = [
    'Two Indian vessels attacked in the strait, leading to diplomatic protests from New Delhi',
    'Two Indian vessels attacked in strait, leading India to formally protest to Iran',
  ];
  const out = dedupKeyPoints(dupes);
  assert.equal(out.length, 1, `expected 1 deduped, got ${out.length}: ${JSON.stringify(out)}`);
});

test('Phase 2: full brief on story 170 fixture passes validation', () => {
  const brief = generateVideoBrief({
    story: story170Fixture(),
    evidencePackage: evidenceForStory170(),
    publishability: publishabilityForStory170(),
  });
  const result = validateVideoBrief(brief);
  assert.equal(result.ok, true,
    `story 170 fixture should validate; errors: ${JSON.stringify(result.errors)}`);
});
