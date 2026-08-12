#!/usr/bin/env node
'use strict';

// Scaffold a story fixture from a topic line via Claude, write it to
// fixtures/scaffolded-<id>.json, and run the linter dry-run against it
// so the author sees the predicted story-type and fallback verdict
// without leaving the CLI.
//
// Usage:
//   node scripts/author-fixture.js --topic "Wildfire in Greek islands evacuates 2000 tourists"
//   node scripts/author-fixture.js --topic "..." --id custom-slug --out fixtures/my.json --no-lint

const fs = require('fs');
const path = require('path');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', 'video-pipeline', '.env') });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', 'evidence-first-video-pipeline', '.env') });
} catch (_) { /* dotenv optional */ }

const { completeJSON, hasAnthropic } = require('../src/integrations/anthropic');
const { runPipeline } = require('../src/pipeline/orchestrator');
const { listTypeIds } = require('../src/pipeline/understand/story-types');

// Type-specific guidance appended to the system prompt when --type is set.
// Each hint describes the data shape the type's understand() expects, so
// scaffolds route correctly on the first lint pass.
const TYPE_HINTS = {
  legal_scandal:
    'Legal scandal: include a defendant name in the summary using the pattern "<First Last>, <age>," (e.g. "Jane Smith, 42,"). Specify dollar figures with explicit unit ($400,000 or $400K). List specific charges in key_points (wire fraud, securities fraud, conspiracy, etc.). Cite a federal agency (DOJ, SEC, CFTC, FBI) as the issuer.',
  geopolitics_world:
    'Geopolitics: name 1-2 countries in primary_geos. Reference an institution (EU, NATO, UN, G7). Use diplomatic verbs (announced, signed, declared). Include money amounts with explicit units when relevant ($200 million package). Source from foreign ministries or official communiques.',
  finance_markets:
    'Finance: include rate percentages (4.25%) or dollar figures with units. Name the institution (Federal Reserve, ECB, BOE). State a clear policy action (rate cut, rate hike, rate hold, earnings beat). Cite a central-bank statement, earnings release, or regulator filing.',
  election_result:
    'Election: include vote percentages explicitly ("54.3 percent" or "54.3%"). Name the winner and runner-up parties. State turnout. Use role phrasing like "Prime Minister-elect" or "President-elect". Cite an election commission as the issuer.',
  natural_disaster:
    'Natural disaster: include magnitude in "magnitude X.Y" or "M6.4" format. State casualty counts: "X confirmed dead", "X displaced", "X injured". Cite an agency (BNPB, USGS, FEMA, JMA, EMSC). Use provisional-figure framing, never sensationalist verbs.',
  tech_cyber:
    'Cyber incident: include record count ("3.6 million accounts"), ransom demand ($14 million), CVE id (CVE-2026-12345 format). Name the company. Mention disclosure delay if applicable ("11 days after detection"). Cite the vendor disclosure + a regulator advisory (CISA, FTC, ICO).',
  culture_entertainment:
    'Culture/entertainment: include streaming hours ("480 million streaming hours"), box office ("$189 million opening"), awards count, or chart position ("No. 1"). State the title of the work. Cite the platform or trade press (Lumebox, Variety, Billboard, Box Office Mojo). Use neutral verbs (logged, posted, recorded), never promotional ("masterpiece").',
};

const SYSTEM_PROMPT = [
  'You author synthetic story fixtures for the Quydly evidence-first video pipeline.',
  'A fixture is a self-contained JSON object that downstream stages turn into',
  'a 30-60 second editorial video. Your job: given a topic line, produce one.',
  '',
  'Hard rules:',
  '- Output JSON only. No markdown fences. No commentary. No leading text.',
  '- All facts (figures, names, dates, agencies) must be specific and plausible.',
  '  Where a real institution is uncontroversially right (BNPB for Indonesian',
  '  earthquakes, Iceland Election Commission for Iceland), use it. Where a',
  '  named individual would be misleading (a sitting head-of-state, a real',
  '  defendant), invent a clearly-synthetic name.',
  '- summary must be 2-4 sentences with at least three concrete numeric or',
  '  named facts.',
  '- key_points: 3-5 bullet sentences, each restating one specific fact from',
  '  the summary. Different angles, no duplicates.',
  '- primary_entities: 3-5 lowercase tokens covering the people, parties,',
  '  agencies, and platforms named.',
  '- primary_geos: 1-2 proper-case place names. Prefer well-known cities and',
  '  countries (Reykjavik, Sumatra, London) so the gazetteer can resolve them.',
  '- source_documents: exactly 2 entries. The FIRST must include quote_text',
  '  (10-25 words, attributable to a named speaker), quote_speaker, and',
  '  quote_role. The SECOND can omit quote fields.',
  '- published_at: an ISO 8601 datetime in 2026.',
  '- is_verified: true.',
  '- confidence_score: 7-9. coherence_score: 0.85-0.95. support_score: 0.85-0.95.',
  '  story_score: 40-50. source_count: 2.',
  '- The headline should be a working news headline, not a label. Use Title Case.',
  '- Avoid sensationalist words ("devastating", "stunning", "horrifying").',
  '  Stay neutral and factual.',
  '',
  'Schema (keys must appear, types must match):',
  '{',
  '  "id": "kebab-case-slug",',
  '  "category_id": "world" | "us" | "tech" | "business",',
  '  "headline": "string",',
  '  "summary": "string",',
  '  "key_points": ["string", ...],',
  '  "confidence_score": number,',
  '  "coherence_score": number,',
  '  "support_score": number,',
  '  "story_score": number,',
  '  "source_count": 2,',
  '  "is_verified": true,',
  '  "primary_entities": ["lowercase", ...],',
  '  "primary_geos": ["Proper Case", ...],',
  '  "published_at": "2026-MM-DDTHH:MM:SS.000Z",',
  '  "source_documents": [',
  '    { "id": "...", "type": "...", "title": "...", "issuer": "...", "url": "https://example-fixture.test/...", "date": "Mon DD, 2026", "quote_text": "...", "quote_speaker": "...", "quote_role": "..." },',
  '    { "id": "...", "type": "...", "title": "...", "issuer": "...", "url": "https://example-fixture.test/...", "date": "Mon DD, 2026" }',
  '  ]',
  '}',
].join('\n');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.topic) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (!hasAnthropic()) {
    console.error('error: no Anthropic key — author-fixture requires Claude. Set ANTHROPIC_API_KEY_VIDEO (or VIDEO_ALLOW_SHARED_KEY=1 to bill the shared ANTHROPIC_API_KEY).');
    process.exit(1);
  }

  // Optional --type narrows the scaffold to a registered type so it
  // routes correctly on first lint. Validates against the registered list.
  let typeHint = '';
  if (args.type) {
    const known = listTypeIds();
    if (!known.includes(args.type)) {
      console.error(`error: --type "${args.type}" is not registered. Known: ${known.join(', ')}`);
      process.exit(1);
    }
    typeHint = TYPE_HINTS[args.type] || '';
  }

  const systemPrompt = typeHint
    ? `${SYSTEM_PROMPT}\n\nType-specific guidance for ${args.type}:\n${typeHint}`
    : SYSTEM_PROMPT;

  console.log(`Authoring fixture for topic: "${args.topic}"${args.type ? ` (type=${args.type})` : ''}`);
  console.log('  → calling Claude…');

  let fixture;
  try {
    fixture = await completeJSON({
      system: systemPrompt,
      prompt: `Topic: ${args.topic}\n\nWrite the fixture JSON now.`,
      maxTokens: 2400,
    });
  } catch (err) {
    console.error(`error: Claude call failed — ${err.message}`);
    process.exit(1);
  }

  // Defensive overrides — Claude sometimes drifts on the meta fields.
  if (args.id) fixture.id = args.id;
  if (!fixture.id) fixture.id = slugify(args.topic).slice(0, 60);
  fixture.is_verified = true;
  fixture.source_count = 2;
  if (!fixture.published_at) {
    fixture.published_at = new Date().toISOString();
  }

  const outPath = args.out
    ? path.resolve(args.out)
    : path.resolve(__dirname, '..', 'fixtures', `scaffolded-${slugify(fixture.id)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');

  const relOut = path.relative(process.cwd(), outPath);
  console.log(`  → wrote ${relOut}`);
  console.log('');
  console.log(`Headline: ${fixture.headline}`);
  console.log(`Geo:      ${(fixture.primary_geos || []).join(', ')}`);
  console.log(`Entities: ${(fixture.primary_entities || []).join(', ')}`);
  console.log('');

  if (args.lint === false) {
    console.log('Skipped lint (--no-lint).');
    return;
  }

  console.log('Linting via dry-run…');
  await lintOne(outPath);
}

async function lintOne(fixturePath) {
  const origLog = console.log;
  const origWarn = console.warn;
  const muted = [];
  console.log = (...args) => muted.push(['log', ...args]);
  console.warn = (...args) => muted.push(['warn', ...args]);

  let result, err;
  try {
    result = await runPipeline({
      storyFile: fixturePath,
      dryRunFallbacks: true,
      mode: 'production',
      outputRoot: path.resolve(__dirname, '..', 'output', '.lint'),
    });
  } catch (e) {
    err = e;
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }

  if (err) {
    console.log(`  ERROR — ${err.message}`);
    process.exit(2);
  }

  const fb = result.fallbackReport;
  const storyType = result.storyPackage?.story?.story_type
    || result.storyPackage?.story_type
    || result.storyPackage?.understanding?.story_type
    || 'unknown';
  const wordCount = String(result.storyPackage?.script?.full_script || '')
    .split(/\s+/).filter(Boolean).length;
  const dur = result.storyPackage?.totalDurationSec || 0;

  console.log(`  story_type: ${storyType}`);
  console.log(`  script:     ${wordCount} words, est ${dur.toFixed(1)}s`);
  if (fb?.has_fallbacks) {
    console.log(`  verdict:    WOULD_BLOCK (${fb.count} fallback${fb.count === 1 ? '' : 's'})`);
    for (const item of fb.items) {
      console.log(`    - ${item.kind}${item.detail ? `: ${item.detail}` : ''}`);
    }
  } else {
    console.log(`  verdict:    PASS — would render cleanly in production mode`);
  }
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'no-lint') {
      args.lint = false;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  if (args.lint === undefined) args.lint = true;
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/author-fixture.js --topic "<topic>" [options]

Options:
  --topic "..."       Required. The seed topic Claude expands into a fixture.
  --type <id>         Pin the story type so Claude includes the data fields
                      that route's understand() expects. One of:
                      legal_scandal, geopolitics_world, finance_markets,
                      election_result, natural_disaster, tech_cyber,
                      culture_entertainment.
  --id <slug>         Override the fixture id. Default: slugified topic.
  --out <path>        Output path. Default: fixtures/scaffolded-<id>.json.
  --no-lint           Skip the dry-run lint after writing.
  --help              Show this message.

Examples:
  node scripts/author-fixture.js --topic "EU foreign ministers approve 14th sanctions package on Russia"
  node scripts/author-fixture.js --topic "M7.1 earthquake offshore northern Chile" --id chile-quake
`);
}

main().catch((err) => {
  console.error('author-fixture crashed:', err);
  process.exit(2);
});
