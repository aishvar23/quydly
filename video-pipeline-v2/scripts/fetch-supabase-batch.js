#!/usr/bin/env node
'use strict';

// Pull N stories from Supabase, build fixture-shape JSON for each, and run
// the v2 pipeline against every one. Skips (with a warning) any story that
// no registered story-type matches, or that crashes mid-pipeline. Prints a
// summary table at the end.
//
// Usage:
//   node scripts/fetch-supabase-batch.js --count 10
//   node scripts/fetch-supabase-batch.js --count 3 --skip-render
//   node scripts/fetch-supabase-batch.js --count 5 --category world --score-floor 35
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Recommended:
// MAPBOX_AUTO_GEOCODE=true so unfamiliar geos resolve via Mapbox API.

const fs = require('fs');
const path = require('path');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', 'video-pipeline', '.env') });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', 'evidence-first-video-pipeline', '.env') });
} catch (_) { /* dotenv optional */ }

const {
  fetchStories,
  fetchSourceArticles,
  articlesToSourceDocs,
  storyRowToFixture,
} = require('../src/integrations/supabase');
const { runPipeline } = require('../src/pipeline/orchestrator');

const FROZEN_DIR = path.resolve(__dirname, '..', 'output', '.batch');
const RUN_OUTPUT_ROOT = path.resolve(__dirname, '..', 'output');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const count = Number(args.count || 10);
  const categoryId = args.category || null;
  const scoreFloor = args['score-floor'] != null ? Number(args['score-floor']) : 0;
  const coherenceFloor = args['coherence-floor'] != null ? Number(args['coherence-floor']) : 0.65;
  const supportFloor = args['support-floor'] != null ? Number(args['support-floor']) : 0.65;
  const skipRender = Boolean(args['skip-render']);
  const useAI = Boolean(args['use-ai']);
  const isVerified = String(args.verified ?? 'true').toLowerCase() !== 'false';
  const dryRun = Boolean(args['dry-run-fallbacks']);
  const storyId = args['story-id'] != null ? Number(args['story-id']) : null;
  const minId   = args['min-id']   != null ? Number(args['min-id'])   : null;

  if (!process.env.MAPBOX_AUTO_GEOCODE) {
    console.warn('[batch] MAPBOX_AUTO_GEOCODE not set — off-gazetteer geos will fall back. Recommend: $env:MAPBOX_AUTO_GEOCODE = "true"');
  }

  if (storyId != null) {
    console.log(`[batch] Fetching exact story id=${storyId} (audit-floor filters bypassed)…`);
  } else {
    console.log(`[batch] Fetching up to ${count} stories from Supabase…`);
    console.log(`        verified=${isVerified}  score_floor=${scoreFloor}  coherence>=${coherenceFloor}  support>=${supportFloor}  category=${categoryId || '(any)'}  min_id=${minId ?? '(none)'}`);
  }

  let stories;
  try {
    stories = await fetchStories({
      count, isVerified, scoreFloor, coherenceFloor, supportFloor,
      categoryId, storyId, minId, random: true,
    });
  } catch (err) {
    console.error(`[batch] Supabase fetch failed: ${err.message}`);
    process.exit(1);
  }

  if (stories.length === 0) {
    console.error('[batch] No stories matched the filters.');
    process.exit(1);
  }

  console.log(`[batch] Got ${stories.length} stories. Resolving source articles…`);
  fs.mkdirSync(FROZEN_DIR, { recursive: true });

  const fixtures = [];
  for (const story of stories) {
    // Stories synthesized after P0-1 carry source_documents inline. Skip the
    // raw_articles roundtrip in that case — articles get retention-pruned and
    // the inline snapshot is the authoritative source anyway.
    const hasInlineSnapshot = Array.isArray(story.source_documents) && story.source_documents.length > 0;
    let sourceDocs = [];
    if (!hasInlineSnapshot) {
      const articles = await fetchSourceArticles(story.cluster_id);
      sourceDocs = articlesToSourceDocs(articles);
    }
    const fixture = storyRowToFixture(story, sourceDocs);
    const frozenPath = path.join(FROZEN_DIR, `story-${fixture.id}.json`);
    fs.writeFileSync(frozenPath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
    fixtures.push({ frozenPath, fixture });
    console.log(`        - story ${fixture.id} "${truncate(fixture.headline, 60)}" ${fixture.source_documents.length}src ${fixture.primary_geos.length}geo`);
  }

  console.log(`[batch] Running pipeline on ${fixtures.length} stories…`);
  const results = [];
  for (const { frozenPath, fixture } of fixtures) {
    const label = `story-${fixture.id}`;
    process.stdout.write(`        - ${label.padEnd(20)} `);
    const result = await runOne({ frozenPath, skipRender, useAI, dryRunFallbacks: dryRun });
    results.push({ id: fixture.id, headline: fixture.headline, ...result });
    process.stdout.write(`${result.status}\n`);
  }

  console.log('');
  printTable(results);

  const errs = results.filter((r) => r.status === 'ERROR').length;
  const rejected = results.filter((r) => r.status === 'REJECTED').length;
  // OK and FALLBACKS both produced an output dir; REJECTED and ERROR did not.
  const completed = results.filter((r) => r.status === 'OK' || r.status === 'FALLBACKS').length;
  console.log('');
  console.log(`Frozen fixtures: ${path.relative(process.cwd(), FROZEN_DIR)}`);
  console.log(`${completed}/${results.length} pipelines completed (${rejected} rejected by audit, ${errs} errored).`);

  if (errs > 0 || rejected > 0) process.exit(1);
}

async function runOne({ frozenPath, skipRender, useAI, dryRunFallbacks }) {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  try {
    const r = await runPipeline({
      storyFile: frozenPath,
      mode: 'poc',
      skipRender,
      useAI,
      dryRunFallbacks,
      outputRoot: RUN_OUTPUT_ROOT,
    });
    // Audit can refuse a story before any pipeline work happens. The early
    // return has no fallbackReport / no storyPackage — surface as REJECTED
    // so it doesn't get counted as a successful render.
    if (r.state === 'VIDEO_CANDIDATE_REJECTED') {
      return {
        status: 'REJECTED',
        storyType: '-',
        wordCount: 0,
        fallbacks: [],
        duration: 0,
        outputDir: r.outputDir ? path.relative(process.cwd(), r.outputDir) : '-',
        rejectReason: r.audit?.video_skip_reason || 'audit rejected (no reason supplied)',
      };
    }
    const fb = r.fallbackReport;
    const storyType = r.storyPackage?.understanding?.story_type
      || r.storyPackage?.story?.story_type
      || r.storyPackage?.story_type
      || 'unknown';
    const wordCount = String(r.storyPackage?.script?.full_script || '')
      .split(/\s+/).filter(Boolean).length;
    return {
      status: fb?.has_fallbacks ? 'FALLBACKS' : 'OK',
      storyType,
      wordCount,
      fallbacks: (fb?.items || []).map((i) => i.kind),
      duration: r.storyPackage?.totalDurationSec || 0,
      outputDir: path.relative(process.cwd(), r.outputDir),
    };
  } catch (error) {
    return {
      status: 'ERROR',
      storyType: '-',
      wordCount: 0,
      fallbacks: [],
      duration: 0,
      outputDir: '-',
      error: error.message,
    };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

function printTable(results) {
  const cols = [
    { header: 'id',         w: 8,  get: (r) => r.id },
    { header: 'status',     w: 11, get: (r) => r.status },
    { header: 'story_type', w: 22, get: (r) => r.storyType || '-' },
    { header: 'words',      w: 6,  get: (r) => String(r.wordCount || '-') },
    { header: 'dur',        w: 7,  get: (r) => r.duration ? `${r.duration.toFixed(1)}s` : '-' },
    { header: 'output / detail', w: 64, get: (r) => detailFor(r) },
  ];
  console.log(cols.map((c) => c.header.padEnd(c.w)).join('  '));
  console.log(cols.map((c) => '-'.repeat(c.w)).join('  '));
  for (const r of results) {
    console.log(cols.map((c) => String(c.get(r)).slice(0, c.w).padEnd(c.w)).join('  '));
  }
}

function detailFor(r) {
  if (r.error) return r.error;
  if (r.rejectReason) return `audit rejected: ${r.rejectReason}`;
  if (r.fallbacks.length > 0) return `${r.outputDir} :: ${r.fallbacks.join(', ')}`;
  return r.outputDir;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
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
  console.log(`Usage: node scripts/fetch-supabase-batch.js [options]

Options:
  --count N            Number of stories to fetch (default: 10).
  --category <id>      Restrict to a category_id (world, us, tech, etc.).
  --score-floor N      Minimum story_score (default: 0).
  --coherence-floor F  Minimum coherence_score (default: 0.65, matches validate).
  --support-floor F    Minimum support_score (default: 0.65, matches validate).
  --verified true|false Filter on is_verified (default: true).
  --skip-render        Run all pipeline stages but skip the MP4 render.
  --dry-run-fallbacks  Force-synthetic voice + exit before render. Cheapest.
  --use-ai             Generate scripts via Claude (otherwise deterministic).
  --help               Show this message.

Required env:
  SUPABASE_URL, SUPABASE_SERVICE_KEY

Recommended env:
  MAPBOX_AUTO_GEOCODE=true   so off-gazetteer places resolve via Mapbox API
  ELEVENLABS_API_KEY          real TTS (else synthetic timing fallback)
  ANTHROPIC_API_KEY           required for --use-ai
  MAPBOX_TOKEN                map module rendering
`);
}

main().catch((err) => {
  console.error('[batch] crashed:', err);
  process.exit(2);
});
