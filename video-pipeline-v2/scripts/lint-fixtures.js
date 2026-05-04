#!/usr/bin/env node
'use strict';

// Walk fixtures/, run each through the pipeline in dry-run-fallbacks mode,
// and print a summary table of: validation status, story-type routing, and
// predicted fallback verdict. Exits non-zero on hard errors (pipeline crash
// or validation failure) so this can be a CI gate; with --strict it also
// fails on would-block predictions.
//
// Usage:
//   node scripts/lint-fixtures.js
//   node scripts/lint-fixtures.js --mode production --strict

const fs = require('fs');
const path = require('path');

// Mirror index.js dotenv loading so ELEVENLABS / MAPBOX / ANTHROPIC env
// flow into the pipeline. Linter forces synthetic voice anyway, so
// ElevenLabs is irrelevant; Mapbox affects asset resolution and Anthropic
// is unused in dry-run.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', 'video-pipeline', '.env') });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', 'evidence-first-video-pipeline', '.env') });
} catch (_) { /* dotenv optional */ }

const { runPipeline } = require('../src/pipeline/orchestrator');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // --ci is shorthand for --strict in poc mode: catch pipeline crashes
  // and unintentional would-blocks. Production-mode validation rejection
  // (is_verified=false) is intentional in test fixtures, so we don't gate
  // on it. Combine with --exclude to skip expected-fail fixtures.
  const ci = Boolean(args.ci);
  const mode = args.mode || 'poc';
  const strict = ci || Boolean(args.strict);
  const fixturesDir = path.resolve(__dirname, '..', 'fixtures');
  const lintOutputRoot = path.resolve(__dirname, '..', 'output', '.lint');

  if (!fs.existsSync(fixturesDir)) {
    console.error(`No fixtures directory at ${fixturesDir}`);
    process.exit(1);
  }

  const excludeGlobs = (args.exclude || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const files = fs.readdirSync(fixturesDir)
    .filter((n) => n.endsWith('.json'))
    .filter((n) => !excludeGlobs.some((g) => matchesGlob(n, g)))
    .sort();

  if (files.length === 0) {
    console.error('No fixtures found.');
    process.exit(1);
  }

  console.log(`Linting ${files.length} fixture(s) in mode=${mode}${strict ? ' (strict)' : ''}`);
  console.log('');

  const results = [];
  for (const file of files) {
    const fullPath = path.join(fixturesDir, file);
    process.stdout.write(`  ${file.padEnd(42)} `);

    const result = await lintOne(fullPath, { mode, outputRoot: lintOutputRoot });
    results.push({ file, ...result });

    process.stdout.write(`${result.status}\n`);
  }

  console.log('');
  printTable(results);

  const errorCount = results.filter((r) => r.status === 'ERROR').length;
  const rejectedCount = results.filter((r) => r.status === 'REJECTED').length;
  const blockCount = results.filter((r) => r.status === 'WOULD_BLOCK').length;
  const passCount = results.filter((r) => r.status === 'PASS').length;

  console.log('');
  console.log(`${passCount} pass · ${blockCount} would-block · ${rejectedCount} rejected · ${errorCount} error`);

  // REJECTED is a hard fail — the audit refused the story, so the pipeline
  // never ran. Treat alongside ERROR for exit-code purposes.
  if (errorCount > 0 || rejectedCount > 0) process.exit(1);
  if (strict && blockCount > 0) process.exit(1);
  process.exit(0);
}

async function lintOne(fixturePath, { mode, outputRoot }) {
  // Suppress orchestrator log noise — we want only the linter's own output.
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  try {
    const r = await runPipeline({
      storyFile: fixturePath,
      dryRunFallbacks: true,
      mode,
      outputRoot,
    });
    // Audit can refuse a story before any pipeline work happens. The early
    // return has no fallbackReport / no storyPackage — treat as a distinct
    // REJECTED status, not as a fall-through PASS.
    if (r.state === 'VIDEO_CANDIDATE_REJECTED') {
      return {
        status: 'REJECTED',
        storyType: '-',
        wordCount: 0,
        fallbacks: [],
        durationSec: 0,
        rejectReason: r.audit?.video_skip_reason || 'audit rejected (no reason supplied)',
      };
    }
    const fb = r.fallbackReport;
    const storyType = r.storyPackage?.story?.story_type
      || r.storyPackage?.story_type
      || r.storyPackage?.understanding?.story_type
      || 'unknown';
    const wordCount = countWords(r.storyPackage?.script?.full_script);
    return {
      status: fb?.has_fallbacks ? 'WOULD_BLOCK' : 'PASS',
      storyType,
      wordCount,
      fallbacks: (fb?.items || []).map((i) => ({ kind: i.kind, detail: i.detail || '' })),
      durationSec: r.storyPackage?.totalDurationSec,
    };
  } catch (error) {
    return {
      status: 'ERROR',
      storyType: '-',
      wordCount: 0,
      fallbacks: [],
      durationSec: 0,
      error: error.message,
    };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

function printTable(results) {
  const cols = [
    { header: 'fixture',     width: 42, get: (r) => r.file },
    { header: 'status',      width: 12, get: (r) => r.status },
    { header: 'story_type',  width: 22, get: (r) => r.storyType },
    { header: 'words',       width: 6,  get: (r) => String(r.wordCount || '-') },
    { header: 'duration',    width: 9,  get: (r) => r.durationSec ? `${r.durationSec.toFixed(1)}s` : '-' },
    { header: 'detail',      width: 60, get: (r) => detailFor(r) },
  ];

  const sep = cols.map((c) => '-'.repeat(c.width)).join('  ');
  console.log(cols.map((c) => c.header.padEnd(c.width)).join('  '));
  console.log(sep);
  for (const r of results) {
    console.log(cols.map((c) => String(c.get(r)).slice(0, c.width).padEnd(c.width)).join('  '));
  }
}

function detailFor(r) {
  if (r.error) return r.error;
  if (r.rejectReason) return `audit rejected: ${r.rejectReason}`;
  if (r.fallbacks.length === 0) return 'clean';
  return r.fallbacks.map((f) => f.detail ? `${f.kind}: ${f.detail}` : f.kind).join(' | ');
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

// Tiny glob matcher — supports `*` wildcards. Used by --exclude.
function matchesGlob(name, pattern) {
  const re = '^' + pattern.split('*').map(
    (p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'),
  ).join('.*') + '$';
  return new RegExp(re).test(name);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/lint-fixtures.js [options]

Options:
  --mode poc|production  Validation strictness (default: poc).
                         In production, fixtures with is_verified=false ERROR.
  --strict               Exit non-zero on WOULD_BLOCK as well as ERROR/REJECTED.
                         Default exits non-zero only on ERROR/REJECTED.
  --ci                   Shorthand for --strict (poc mode).
                         For pre-commit / GitHub Actions gating.
                         Use --exclude to skip expected-fail fixtures.
  --exclude "<globs>"    Comma-separated globs to skip. e.g. "*test*,scaffolded-*"
  --help                 Show this message.

Status legend:
  PASS         Story validates and dry-run predicts no fallbacks.
  WOULD_BLOCK  Story validates but dry-run predicts at least one fallback
               (production gate would refuse to render).
  REJECTED     Audit refused the story (state=VIDEO_CANDIDATE_REJECTED).
               Pipeline never ran. Counts as a hard fail.
  ERROR        Story failed validation OR pipeline crashed.
`);
}

main().catch((err) => {
  console.error('Linter crashed:', err);
  process.exit(2);
});
