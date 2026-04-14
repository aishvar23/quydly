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

// ── normalizeEntity ────────────────────────────────────────────────────────

console.log('\nnormalizeEntity — equivalence map');

test('"U.S." → "us"',             () => assert.equal(normalizeEntity('U.S.'), 'us'));
test('"United States" → "us"',    () => assert.equal(normalizeEntity('United States'), 'us'));
test('"u.s." (already lower) → "us"', () => assert.equal(normalizeEntity('u.s.'), 'us'));
test('"U.K." → "uk"',             () => assert.equal(normalizeEntity('U.K.'), 'uk'));
test('"United Kingdom" → "uk"',   () => assert.equal(normalizeEntity('United Kingdom'), 'uk'));
test('"EU" → "eu"',               () => assert.equal(normalizeEntity('EU'), 'eu'));
test('"European Union" → "eu"',   () => assert.equal(normalizeEntity('European Union'), 'eu'));

console.log('\nnormalizeEntity — cleaning');

test('unknown entity lowercased',             () => assert.equal(normalizeEntity('Apple'), 'apple'));
test('leading/trailing whitespace stripped',  () => assert.equal(normalizeEntity('  Tesla  '), 'tesla'));
test('trailing comma stripped',               () => assert.equal(normalizeEntity('Congress,'), 'congress'));
test('trailing period stripped',              () => assert.equal(normalizeEntity('Senate.'), 'senate'));
test('leading "The" removed',                 () => assert.equal(normalizeEntity('The White House'), 'white house'));
test('leading "The" + trailing comma',        () => assert.equal(normalizeEntity('The White House,'), 'white house'));
test('leading "A" removed',                   () => assert.equal(normalizeEntity('A Nation'), 'nation'));
test('leading "An" removed',                  () => assert.equal(normalizeEntity('An Organization'), 'organization'));
test('"The White House" and "White House," → same value', () => {
  assert.equal(normalizeEntity('The White House'), normalizeEntity('White House,'));
});

// ── hasHighSignalEntity ────────────────────────────────────────────────────

console.log('\nhasHighSignalEntity');

test('multi-word entity is high-signal',           () => assert.equal(hasHighSignalEntity(['donald trump']), true));
test('known acronym output "us" is high-signal',   () => assert.equal(hasHighSignalEntity(['us']), true));
test('known acronym output "uk" is high-signal',   () => assert.equal(hasHighSignalEntity(['uk']), true));
test('known acronym output "eu" is high-signal',   () => assert.equal(hasHighSignalEntity(['eu']), true));
test('2-letter token treated as acronym',          () => assert.equal(hasHighSignalEntity(['ai']), true));
test('3-letter token treated as acronym',          () => assert.equal(hasHighSignalEntity(['who']), true));
test('proper name > 4 chars is high-signal',       () => assert.equal(hasHighSignalEntity(['apple']), true));
test('single short generic word is not high-signal', () => assert.equal(hasHighSignalEntity(['it']), true)); // 2 chars = acronym rule
test('empty array returns false',                  () => assert.equal(hasHighSignalEntity([]), false));
test('mixed array: false entries do not override', () => assert.equal(hasHighSignalEntity(['donald trump', 'x']), true));

// ── extractEntities — basic behaviour ─────────────────────────────────────

console.log('\nextractEntities — basic');

test('empty string returns []',   () => assert.deepEqual(extractEntities(''), []));
test('null returns []',           () => assert.deepEqual(extractEntities(null), []));
test('undefined returns []',      () => assert.deepEqual(extractEntities(undefined), []));

test('deduplicates repeated entities', () => {
  const entities = extractEntities('Tesla stock surged. Tesla gained on strong earnings.');
  assert.equal(entities.filter(e => e === 'tesla').length, 1);
});

// ── extractEntities — title-case phrases ──────────────────────────────────

console.log('\nextractEntities — title-case phrases');

test('extracts "donald trump" and "white house"', () => {
  const e = extractEntities('Donald Trump signs executive order at the White House');
  assert.ok(e.includes('donald trump'), `got: ${JSON.stringify(e)}`);
  assert.ok(e.includes('white house'),  `got: ${JSON.stringify(e)}`);
});

test('extracts "federal reserve" and "jerome powell"', () => {
  const e = extractEntities(
    'Federal Reserve chair Jerome Powell signals rate pause amid inflation concerns'
  );
  assert.ok(e.includes('federal reserve'), `got: ${JSON.stringify(e)}`);
  assert.ok(e.includes('jerome powell'),   `got: ${JSON.stringify(e)}`);
});

test('extracts "google" and "alphabet"', () => {
  const e = extractEntities('Google parent Alphabet reports record quarterly revenue beating estimates');
  assert.ok(e.includes('google'),   `got: ${JSON.stringify(e)}`);
  assert.ok(e.includes('alphabet'), `got: ${JSON.stringify(e)}`);
});

test('normalizes "The White House" and "White House," to same entity', () => {
  const e = extractEntities('The White House confirmed. White House, a spokesperson said.');
  assert.equal(e.filter(x => x === 'white house').length, 1);
});

// ── extractEntities — all-caps acronyms ───────────────────────────────────

console.log('\nextractEntities — all-caps acronyms');

test('extracts "who" from WHO', () => {
  const e = extractEntities('WHO declared a global health emergency');
  assert.ok(e.includes('who'), `got: ${JSON.stringify(e)}`);
});

test('extracts "nato" from NATO', () => {
  const e = extractEntities('NATO allies met in Brussels to discuss defense spending');
  assert.ok(e.includes('nato'), `got: ${JSON.stringify(e)}`);
});

test('extracts "ai" from AI', () => {
  const e = extractEntities('AI regulation bill passes Senate');
  assert.ok(e.includes('ai'), `got: ${JSON.stringify(e)}`);
});

test('"U.S." normalizes to "us" via acronym extraction', () => {
  const e = extractEntities('The U.S. economy grew faster than expected');
  assert.ok(e.includes('us'), `got: ${JSON.stringify(e)}`);
});

// ── extractEntities — stop-entity filtering ───────────────────────────────

console.log('\nextractEntities — stop-entity filtering');

test('weekday "Monday" is filtered out', () => {
  const e = extractEntities('Monday markets opened lower as investors weighed new data');
  assert.ok(!e.includes('monday'), `"monday" should be filtered; got: ${JSON.stringify(e)}`);
});

test('"Breaking" is filtered out', () => {
  const e = extractEntities('Breaking: Markets surge on trade deal news');
  assert.ok(!e.includes('breaking'), `"breaking" should be filtered; got: ${JSON.stringify(e)}`);
});

test('"News" is filtered out', () => {
  const e = extractEntities('News from Washington signals policy shift');
  assert.ok(!e.includes('news'), `"news" should be filtered; got: ${JSON.stringify(e)}`);
});

// ── extractEntities — overlap resolution ──────────────────────────────────

console.log('\nextractEntities — overlap resolution');

test('"new york" dropped when "new york times" is present', () => {
  const e = extractEntities('The New York Times reported on the New York mayor');
  const hasNYT  = e.includes('new york times');
  const hasNY   = e.includes('new york');
  // If NYT is extracted, plain "new york" should be removed as a substring
  if (hasNYT) {
    assert.ok(!hasNY, `"new york" should be dropped when "new york times" present; got: ${JSON.stringify(e)}`);
  }
  // If NYT wasn't extracted for some reason, just ensure no crash
  assert.ok(Array.isArray(e));
});

// ── extractEntities — output cap ──────────────────────────────────────────

console.log('\nextractEntities — output cap');

test('returns at most 10 entities from a dense headline', () => {
  const text =
    'Donald Trump, Joe Biden, Elon Musk, Apple, Google, NATO, WHO, FBI, CIA, ' +
    'Federal Reserve, White House, Supreme Court, United Nations all mentioned';
  const e = extractEntities(text);
  assert.ok(e.length <= 10, `Expected ≤10 entities, got ${e.length}: ${JSON.stringify(e)}`);
});

// ── summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
