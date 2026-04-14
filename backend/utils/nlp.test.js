// Phase 2 unit tests — nlp.js
// Run: node backend/utils/nlp.test.js

import assert from 'assert/strict';
import { normalizeEntity, extractEntities, hasHighSignalEntity } from './nlp.js';

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

// ── 2.2 normalizeEntity ────────────────────────────────────────────────────

console.log('\nnormalizeEntity');

test('"U.S." → "us"', () => assert.equal(normalizeEntity('U.S.'), 'us'));
test('"United States" → "us"', () => assert.equal(normalizeEntity('United States'), 'us'));
test('"u.s." (already lower) → "us"', () => assert.equal(normalizeEntity('u.s.'), 'us'));

test('"U.K." → "uk"', () => assert.equal(normalizeEntity('U.K.'), 'uk'));
test('"United Kingdom" → "uk"', () => assert.equal(normalizeEntity('United Kingdom'), 'uk'));

test('"EU" → "eu"', () => assert.equal(normalizeEntity('EU'), 'eu'));
test('"European Union" → "eu"', () => assert.equal(normalizeEntity('European Union'), 'eu'));

test('unknown entity lowercased', () => assert.equal(normalizeEntity('Apple'), 'apple'));
test('leading/trailing whitespace stripped', () => assert.equal(normalizeEntity('  Tesla  '), 'tesla'));

// ── 2.2 hasHighSignalEntity ────────────────────────────────────────────────

console.log('\nhasHighSignalEntity');

test('returns true when an entity length > 3', () =>
  assert.equal(hasHighSignalEntity(['us', 'apple', 'nasa']), true));

test('returns false when all entities ≤ 3 chars', () =>
  assert.equal(hasHighSignalEntity(['us', 'uk', 'eu']), false));

test('empty array returns false', () =>
  assert.equal(hasHighSignalEntity([]), false));

// ── 2.3 extractEntities on 3 real headlines ───────────────────────────────

console.log('\nextractEntities — real headlines');

test('headline 1: extracts "Donald Trump" and "White House"', () => {
  const entities = extractEntities(
    'Donald Trump signs executive order at the White House'
  );
  assert.ok(entities.includes('donald trump'), `got: ${JSON.stringify(entities)}`);
  assert.ok(entities.includes('white house'), `got: ${JSON.stringify(entities)}`);
});

test('headline 2: extracts "Federal Reserve" and "Jerome Powell"', () => {
  const entities = extractEntities(
    'Federal Reserve chair Jerome Powell signals rate pause amid inflation concerns'
  );
  assert.ok(entities.includes('federal reserve'), `got: ${JSON.stringify(entities)}`);
  assert.ok(entities.includes('jerome powell'), `got: ${JSON.stringify(entities)}`);
});

test('headline 3: extracts "Google" and "Alphabet"', () => {
  const entities = extractEntities(
    'Google parent Alphabet reports record quarterly revenue beating estimates'
  );
  assert.ok(entities.includes('google'), `got: ${JSON.stringify(entities)}`);
  assert.ok(entities.includes('alphabet'), `got: ${JSON.stringify(entities)}`);
});

test('deduplicates repeated entities (same entity in two sentences)', () => {
  const entities = extractEntities(
    'Tesla stock surged. Tesla gained on strong earnings.'
  );
  const teslaCount = entities.filter(e => e === 'tesla').length;
  assert.equal(teslaCount, 1);
});

test('empty string returns []', () => {
  assert.deepEqual(extractEntities(''), []);
});

test('null/undefined returns []', () => {
  assert.deepEqual(extractEntities(null), []);
  assert.deepEqual(extractEntities(undefined), []);
});

// ── summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
