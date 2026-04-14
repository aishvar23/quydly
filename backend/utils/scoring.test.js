// Phase 3 unit tests — scoring.js
// Run: node backend/utils/scoring.test.js

import assert from 'assert/strict';
import FLAGS from '../../config/flags.js';
import {
  computeClusterScore,
  clusterDisposition,
  computeStoryScore,
  storyDisposition,
} from './scoring.js';

const { cluster: CT, story: ST } = FLAGS.scoring;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function approx(a, b, delta = 0.001) {
  if (Math.abs(a - b) > delta) {
    throw new Error(`Expected ~${b}, got ${a}`);
  }
}

// ── 3.2 computeClusterScore ───────────────────────────────────────────────

console.log('\ncomputeClusterScore');

// Recency helper: build an updated_at timestamp N hours ago
function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

test('log scaling: 2 articles yields log(3) × 2 in article component', () => {
  const cluster = {
    article_ids:      ['a', 'b'],
    unique_domains:   [],
    primary_entities: [],
    updated_at:       null,
  };
  // article_count_score = log(3) ≈ 1.0986; 2× = 2.1972
  // domains=0, entities=0, recency=0.1 (null → old)
  const expected = 2 * Math.log(3) + 0 + 0 + 2 * 0.1;
  approx(computeClusterScore(cluster), expected);
});

test('recency: ≤6h → 1.0, ≤12h → 0.7, ≤24h → 0.4, older → 0.1', () => {
  const base = { article_ids: [], unique_domains: [], primary_entities: [] };

  approx(computeClusterScore({ ...base, updated_at: hoursAgo(2)  }), 2 * 0 + 0 + 0 + 2 * 1.0);
  approx(computeClusterScore({ ...base, updated_at: hoursAgo(8)  }), 2 * 0 + 0 + 0 + 2 * 0.7);
  approx(computeClusterScore({ ...base, updated_at: hoursAgo(18) }), 2 * 0 + 0 + 0 + 2 * 0.4);
  approx(computeClusterScore({ ...base, updated_at: hoursAgo(30) }), 2 * 0 + 0 + 0 + 2 * 0.1);
});

test('invalid updated_at falls back to recency 0.1', () => {
  const base = { article_ids: [], unique_domains: [], primary_entities: [] };
  const scoreInvalid = computeClusterScore({ ...base, updated_at: 'not-a-date' });
  const scoreOld     = computeClusterScore({ ...base, updated_at: hoursAgo(100) });
  approx(scoreInvalid, scoreOld);
});

test('weighted sum: 5 articles, 3 domains, 4 entities, ≤6h → meets eligible threshold', () => {
  const cluster = {
    article_ids:      ['a', 'b', 'c', 'd', 'e'],
    unique_domains:   ['bbc.co.uk', 'nytimes.com', 'reuters.com'],
    primary_entities: ['Joe Biden', 'White House', 'Congress', 'Senate'],
    updated_at:       hoursAgo(3),
  };
  // article: 2×log(6)≈3.58; domain: 3×3=9; entity: 2×4=8; recency: 2×1=2 → 22.58
  const score = computeClusterScore(cluster);
  assert.ok(score >= CT.eligible, `Expected ≥${CT.eligible}, got ${score}`);
});

test('missing arrays treated as empty (no crash)', () => {
  const score = computeClusterScore({});
  assert.ok(typeof score === 'number' && !isNaN(score));
});

// ── 3.3 clusterDisposition ────────────────────────────────────────────────

console.log('\nclusterDisposition');

test(`score = ${CT.eligible} → eligible`,         () => assert.equal(clusterDisposition(CT.eligible),       'eligible'));
test(`score = ${CT.eligible + 5} → eligible`,     () => assert.equal(clusterDisposition(CT.eligible + 5),   'eligible'));
test(`score = ${CT.eligible - 0.1} → optional`,   () => assert.equal(clusterDisposition(CT.eligible - 0.1), 'optional'));
test(`score = ${CT.optional} → optional`,          () => assert.equal(clusterDisposition(CT.optional),       'optional'));
test(`score = ${CT.optional - 0.1} → discard`,    () => assert.equal(clusterDisposition(CT.optional - 0.1), 'discard'));
test('score = 0 → discard',                        () => assert.equal(clusterDisposition(0),                 'discard'));

// ── 3.4 computeStoryScore ─────────────────────────────────────────────────

console.log('\ncomputeStoryScore');

test('basic calculation: 3 articles, 4 entities, 2/3 corroborated facts, confidence=8', () => {
  const cluster = {
    article_ids:      ['a', 'b', 'c'],
    primary_entities: ['entity1', 'entity2', 'entity3', 'entity4'],
  };
  const synthesis = {
    confidence_score: 8,
    facts: [
      { fact: 'A', source_count: 2 },
      { fact: 'B', source_count: 3 },
      { fact: 'C', source_count: 1 },
    ],
  };
  // source=3, consistency=2/3, entity=4, confidence=8
  // score = 2×3 + 4×(2/3)×10 + 1×4 + 2×8 = 6 + 26.667 + 4 + 16 = 52.667
  const result = computeStoryScore(cluster, synthesis);
  approx(result.story_score, 6 + (4 * (2/3) * 10) + 4 + 16, 0.01);
  approx(result.consistency_score, 2/3, 0.001);
  assert.equal(result.source_count, 3);
});

test('entity penalty: < 2 entities → entity_score = 0', () => {
  const cluster = {
    article_ids:      ['a', 'b'],
    primary_entities: ['solo'],  // length = 1 → penalty
  };
  const synthesis = {
    confidence_score: 7,
    facts: [{ fact: 'X', source_count: 2 }],
  };
  const result = computeStoryScore(cluster, synthesis);
  // source=2, consistency=1.0, entity=0, confidence=7
  // score = 4 + 40 + 0 + 14 = 58
  approx(result.story_score, 4 + 40 + 0 + 14);
});

test('entity cap: > 6 entities → entity_score capped at 6', () => {
  const cluster = {
    article_ids:      ['a'],
    primary_entities: ['e1','e2','e3','e4','e5','e6','e7','e8'], // 8 → capped to 6
  };
  const synthesis = {
    confidence_score: 5,
    facts: [],
  };
  const result = computeStoryScore(cluster, synthesis);
  // entity_score = 6 (not 8), score = 2×1 + 0 + 6 + 10 = 18
  approx(result.story_score, 2 + 0 + 6 + 10);
});

test('no facts → consistency_score = 0', () => {
  const cluster = {
    article_ids:      ['a', 'b'],
    primary_entities: ['Entity One', 'Entity Two'],
  };
  const synthesis = { confidence_score: 6, facts: [] };
  const result = computeStoryScore(cluster, synthesis);
  assert.equal(result.consistency_score, 0);
});

test('invalid confidence_score (null) defaults to 0', () => {
  const cluster = {
    article_ids:      ['a', 'b'],
    primary_entities: ['e1', 'e2'],
  };
  const withNull  = computeStoryScore(cluster, { confidence_score: null,      facts: [] });
  const withValid = computeStoryScore(cluster, { confidence_score: 0,         facts: [] });
  approx(withNull.story_score, withValid.story_score);
});

test('invalid confidence_score (NaN) defaults to 0', () => {
  const cluster = {
    article_ids:      ['a'],
    primary_entities: ['e1', 'e2'],
  };
  const result = computeStoryScore(cluster, { confidence_score: NaN, facts: [] });
  assert.ok(Number.isFinite(result.story_score), 'story_score must be finite');
});

test('confidence_score is clamped to 0–10 (out-of-range value)', () => {
  const cluster = {
    article_ids:      ['a', 'b'],
    primary_entities: ['e1', 'e2'],
  };
  const tooHigh = computeStoryScore(cluster, { confidence_score: 999, facts: [] });
  const capped  = computeStoryScore(cluster, { confidence_score: 10,  facts: [] });
  approx(tooHigh.story_score, capped.story_score);
});

test('duplicate article_ids deduplicated in source_count', () => {
  const cluster = {
    article_ids:      ['a', 'a', 'b', 'b', 'b'], // 5 raw, 2 unique
    primary_entities: ['e1', 'e2'],
  };
  const result = computeStoryScore(cluster, { confidence_score: 5, facts: [] });
  assert.equal(result.source_count, 2);
});

test('returns story_score, consistency_score, source_count keys', () => {
  const result = computeStoryScore(
    { article_ids: ['a'], primary_entities: ['e1', 'e2'] },
    { confidence_score: 6, facts: [] }
  );
  assert.ok('story_score'       in result);
  assert.ok('consistency_score' in result);
  assert.ok('source_count'      in result);
});

// ── 3.5 storyDisposition ──────────────────────────────────────────────────

console.log('\nstoryDisposition');

test(`score = ${ST.publish} → publish`,           () => assert.equal(storyDisposition(ST.publish),       'publish'));
test(`score = ${ST.publish + 15} → publish`,      () => assert.equal(storyDisposition(ST.publish + 15),  'publish'));
test(`score = ${ST.publish - 0.1} → review`,      () => assert.equal(storyDisposition(ST.publish - 0.1), 'review'));
test(`score = ${ST.review} → review`,             () => assert.equal(storyDisposition(ST.review),        'review'));
test(`score = ${ST.review - 0.1} → reject`,       () => assert.equal(storyDisposition(ST.review - 0.1),  'reject'));
test('score = 0 → reject',                         () => assert.equal(storyDisposition(0),                'reject'));

// ── summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
