'use strict';

// render-from-plan.js — bridge from v2 stage artifacts (stories/<id>/) to MP4.
//
// The v2 pipeline (Python tools/ stages 1-5) produces:
//   stories/<id>/story.json           — Supabase row + cluster + raw_articles
//   stories/<id>/02_evidence.json     — key_facts, numeric_facts, quotes
//   stories/<id>/03_script.md         — markdown narration with <!-- src: ... -->
//   stories/<id>/04_module-plan.json  — module list with kind / text / duration
//   stories/<id>/_meta.json           — story_type, etc.
//
// The legacy orchestrator (src/pipeline/orchestrator.js) ignores those
// artifacts and runs its own end-to-end pipeline. This bridge reuses the
// orchestrator's render machinery (prepare-render-props, generate-voice,
// generate-srt, Remotion CLI invocation) but feeds it the v2 artifacts
// instead of recomputing them.
//
// Output: stories/<id>/06_render-output/{render.mp4, manifest.json,
// render-props.json, narration.mp3 (or null), subtitles.srt, ...}.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');

// Mirror index.js: load v2/.env first, then sibling pipelines as fallback.
// dotenv default does NOT override existing keys, so v2 wins.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(APP_ROOT, '.env') });
  dotenv.config({ path: path.resolve(APP_ROOT, '..', 'video-pipeline', '.env') });
  dotenv.config({ path: path.resolve(APP_ROOT, '..', 'evidence-first-video-pipeline', '.env') });
} catch (_) { /* optional */ }

const { RENDER } = require(path.join(APP_ROOT, 'src/shared/config'));
const { prepareRenderProps } = require(path.join(APP_ROOT, 'src/pipeline/render/prepare-render-props'));
const { generateVoice } = require(path.join(APP_ROOT, 'src/pipeline/voice/generate-voice'));
const { generateSubtitles } = require(path.join(APP_ROOT, 'src/pipeline/subtitles/generate-srt'));

// ─── story_type mapping ──────────────────────────────────────────────────────
// v2 (Python) uses short names; the renderer + brand palette use long names.
const STORY_TYPE_MAP = {
  'geopolitics': 'geopolitics_world',
  'finance': 'finance_markets',
  'legal-scandal': 'legal_scandal',
  'tech': 'tech_cyber',
  'conflict': 'geopolitics_world', // closest existing accent / template
  'policy': 'general',
  'service-journalism': 'general',
};

// ─── kind → componentType mapping ────────────────────────────────────────────
// Keep this conservative. Components that don't exist in the registry render
// as a "[Foo not implemented]" placeholder card (see EvidenceVideo.tsx). For
// each v2 kind we pick the closest existing component, with notes that bubble
// up into manifest.json so the post-render critic can see substitutions.
//
// Registered components (src/render/compositions/EvidenceVideo.tsx):
//   HookStrap, NumberCard, QuoteCard, ChargeCard, DossierCard, MapCallout,
//   TimelineCard, EvidenceShelf, ImpactCard, OutroLockup
function chooseComponent(mod, numericFact) {
  // Only route to NumberCard when the resolved fact has a real numeric value.
  // String values (dates like "2026-04-05", text labels) make NumberCard's
  // useCountUp animation choke and Remotion stalls waiting for the React
  // tree to render.
  const numeric = Boolean(mod.numeric_fact_ref)
    && numericFact != null
    && typeof numericFact.value === 'number'
    && Number.isFinite(numericFact.value);
  switch (mod.kind) {
    case 'hook':
      return { componentType: 'HookStrap', role: 'hook', note: null };
    case 'stakes':
      return numeric
        ? { componentType: 'NumberCard', role: 'stakes', note: null }
        : { componentType: 'ImpactCard', role: 'stakes', note: null };
    case 'map':
      return { componentType: 'MapCallout', role: 'map', note: null };
    case 'evidence':
      return numeric
        ? { componentType: 'NumberCard', role: 'evidence', note: null }
        : { componentType: 'EvidenceShelf', role: 'evidence', note: null };
    case 'quote':
      return { componentType: 'QuoteCard', role: 'evidence', note: null };
    case 'charge':
      return { componentType: 'ChargeCard', role: 'evidence', note: null };
    case 'timeline':
      return { componentType: 'TimelineCard', role: 'evidence', note: null };
    case 'close':
      return {
        componentType: 'OutroLockup',
        role: 'outro',
        note: null,
      };
    default:
      // Unknown kinds get HookStrap as a generic typographic fallback. Note
      // the substitution so it shows up in the manifest.
      return {
        componentType: 'HookStrap',
        role: mod.kind || 'evidence',
        note: `unknown kind "${mod.kind}" → HookStrap fallback`,
      };
  }
}

// ─── asset_hint → assetClass mapping ─────────────────────────────────────────
function mapAssetClass(hint) {
  switch (hint) {
    case 'mute':  return 'graphic';
    case 'data':  return 'data';
    case 'map':   return 'map';
    case 'photo': return 'photo';
    default:      return 'graphic';
  }
}

// ─── parse 03_script.md → script object ──────────────────────────────────────
// The renderer's script object expects:
//   { full_script, segments: [{ role, text }], story_type }
// 03_script.md uses `## Section` headers with body paragraphs. We strip the
// `<!-- src: ... -->` HTML comments to get clean prose, drop H1/H3 headers,
// and group paragraphs by their parent H2 section as segments.
function parseScriptMarkdown(markdown, storyTypeLong) {
  if (!markdown || !markdown.trim()) {
    throw new Error('03_script.md is empty');
  }

  const lines = markdown.split(/\r?\n/);
  const segments = [];
  let currentRole = null;
  let currentBuf = [];

  const flush = () => {
    if (!currentRole) return;
    const text = stripSrcComments(currentBuf.join(' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text) segments.push({ role: currentRole, text });
    currentBuf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#\s/.test(line)) continue;       // H1 page title (e.g. "# Script — story 181")
    if (/^###\s/.test(line)) continue;     // H3 sub-beat headings — body merges into parent H2
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      currentRole = normalizeRole(h2[1]);
      continue;
    }
    if (currentRole) currentBuf.push(line);
  }
  flush();

  if (segments.length === 0) {
    throw new Error('03_script.md produced no segments after parsing — check section headers');
  }

  const fullScript = segments.map((s) => s.text).join(' ').trim();

  return {
    full_script: fullScript,
    segments,
    story_type: storyTypeLong,
    // Mirror keys that prepareRenderProps / module-plan code may sniff later.
    generation_source: 'v2-bridge',
  };
}

// "Hook (3s, 8–11 words)" → "hook"
// "Stakes" → "stakes"
// "Evidence" → "evidence"
// "Close (5–10s, 14–24 words)" → "outro"
function normalizeRole(headerText) {
  const word = String(headerText).toLowerCase().split(/[\s(]/)[0];
  if (word === 'close') return 'outro';
  return word;
}

function stripSrcComments(text) {
  return String(text).replace(/<!--\s*src:[^>]*?-->/g, '');
}

// ─── modules planner ─────────────────────────────────────────────────────────
function buildModules(plan, evidence, scriptObj) {
  if (!Array.isArray(plan.modules) || plan.modules.length === 0) {
    throw new Error('04_module-plan.json: modules[] is empty');
  }
  const numericById = new Map(
    (evidence.numeric_facts || []).map((n) => [n.id, n]),
  );

  const modules = [];
  let cursor = 0;
  for (let i = 0; i < plan.modules.length; i++) {
    const m = plan.modules[i];
    const numericFact = m.numeric_fact_ref ? numericById.get(m.numeric_fact_ref) : null;
    const choice = chooseComponent(m, numericFact);
    const duration = Number(m.duration_sec);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`module ${i}: duration_sec is not a positive number (got ${m.duration_sec})`);
    }

    // Match narration: prefer the segment whose role matches the chosen role.
    // If no exact match, fall back to the nth segment in document order so
    // every module gets *some* narration. Report the substitution in notes.
    const segment = scriptObj.segments.find((s) => s.role === choice.role)
      || scriptObj.segments[Math.min(i, scriptObj.segments.length - 1)];

    const overlayText = String(m.text || '').trim();
    const narration   = segment ? segment.text : overlayText;

    const data = {};
    if (m.numeric_fact_ref) {
      const nf = numericById.get(m.numeric_fact_ref);
      if (nf) {
        // NumberCard reads `count`/`label`/`secondary` from data; fill what we
        // have. We do NOT fabricate cosmetic copy.
        data.count          = String(nf.value);
        data.label          = String(nf.unit || '');
        data.secondary      = String(nf.context || '');
        data.sourceCitation = (nf.source_ids || []).join(', ');
      }
    }

    const startSec = round(cursor);
    const endSec   = round(startSec + duration);

    const notes = [];
    if (choice.note) notes.push(choice.note);
    if (m.numeric_fact_ref && !numericById.has(m.numeric_fact_ref)) {
      notes.push(`numeric_fact_ref "${m.numeric_fact_ref}" not in 02_evidence.json`);
    }

    modules.push({
      moduleId: i + 1,
      role: choice.role,
      componentType: choice.componentType,
      kind: m.kind,
      startSec,
      durationSec: round(duration),
      endSec,
      overlayText,
      narration,
      assetClass: mapAssetClass(m.asset_hint),
      data,
      // Placeholder asset — no Mapbox/Wikimedia fetch in this bridge.
      asset: { kind: 'graphic', src: null, safetyClass: 'graphic' },
      subtitleSuppress: false,
      _planRef: {
        plan_index: i,
        kind: m.kind,
        text: m.text,
        evidence_ref: m.evidence_ref || [],
        asset_hint: m.asset_hint || null,
        numeric_fact_ref: m.numeric_fact_ref || null,
        notes,
      },
    });

    cursor = endSec;
  }

  return { modules, totalDurationSec: round(cursor) };
}

// ─── manifest writer ─────────────────────────────────────────────────────────
// Format described in video-learning/prompts/06-post-render-critic.md. Every
// module gets one row; asset_status='placeholder' for all rows in this bridge
// (we don't fetch external assets), which is honest — stage 7 will surface
// render/missing-asset warns and we want it to.
function buildManifest({ storyId, storyPackage, propsPath, outputPath }) {
  const moduleRows = storyPackage.modules.map((m) => {
    const ref = m._planRef || {};
    const assetStatus = m.asset && m.asset.src ? 'ok' : 'placeholder';
    return {
      module_index: ref.plan_index,
      role: m.role,
      kind: ref.kind || null,
      text: ref.text || m.overlayText,
      planned_duration: round(m.durationSec),
      manifest_duration: round(m.durationSec),
      asset_status: assetStatus,
      asset_kind: m.asset?.kind || 'graphic',
      asset_class: m.assetClass,
      component_type: m.componentType,
      evidence_ref: ref.evidence_ref || [],
      numeric_fact_ref: ref.numeric_fact_ref || null,
      notes: (ref.notes || []).join('; '),
    };
  });

  return {
    story_id: storyId,
    total_duration_sec: round(storyPackage.totalDurationSec),
    modules: moduleRows,
    voice: {
      source: storyPackage.voice.isTimingOnly ? 'synthetic' : 'elevenlabs',
      total_duration_sec: round(storyPackage.voice.totalDurationSec),
      is_timing_only: Boolean(storyPackage.voice.isTimingOnly),
      forced_synthetic: Boolean(storyPackage.voice.forcedSynthetic),
      failure_reason: storyPackage.voice.failureReason || null,
    },
    render: {
      entry_point: RENDER.entryPoint,
      composition_id: RENDER.compositionId,
      output_path: outputPath ? path.relative(APP_ROOT, outputPath).replace(/\\/g, '/') : null,
      props_path: path.relative(APP_ROOT, propsPath).replace(/\\/g, '/'),
      fps: RENDER.fps,
      width: RENDER.width,
      height: RENDER.height,
    },
    bridge: {
      version: 'v2-bridge',
      script_source: '03_script.md',
      plan_source: '04_module-plan.json',
      evidence_source: '02_evidence.json',
    },
  };
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.storyId) {
    printUsage();
    throw new Error('--story-id is required');
  }

  const storyDir = path.join(APP_ROOT, 'stories', String(args.storyId));
  if (!fs.existsSync(storyDir)) {
    throw new Error(`Story workspace not found: ${storyDir}. Run tools/process_story.py first.`);
  }

  // Load v2 inputs. Crash loudly if any are missing — the bridge has no
  // graceful fallback for an unprepared story.
  const meta     = readJson(path.join(storyDir, '_meta.json'));
  const story    = readJson(path.join(storyDir, 'story.json'));
  const evidence = readJson(path.join(storyDir, '02_evidence.json'));
  const scriptMd = fs.readFileSync(path.join(storyDir, '03_script.md'), 'utf8');
  const plan     = readJson(path.join(storyDir, '04_module-plan.json'));

  const storyTypeShort = meta.story_type;
  const storyTypeLong  = STORY_TYPE_MAP[storyTypeShort];
  if (!storyTypeLong) {
    throw new Error(`Unsupported story_type "${storyTypeShort}" (no mapping to renderer story_type)`);
  }

  const outputDir = path.join(storyDir, '06_render-output');
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Build script object.
  const scriptObj = parseScriptMarkdown(scriptMd, storyTypeLong);
  log('SCRIPT', `${scriptObj.segments.length} segments; ${scriptObj.full_script.split(/\s+/).length} words`);

  // 2. Voice (TTS or synthetic timing).
  const voice = await generateVoice(scriptObj, outputDir, {
    forceSynthetic: args.dryRun,
  });
  const voiceLabel = voice.isTimingOnly
    ? (voice.forcedSynthetic ? 'forced synthetic (--dry-run)' : 'synthetic timing (no ELEVENLABS_API_KEY or API failure)')
    : 'real TTS (ElevenLabs)';
  log('VOICE', `${voice.totalDurationSec.toFixed(2)}s ${voiceLabel}`);

  // 3. Modules (built from the plan + evidence + parsed script).
  const { modules, totalDurationSec: planTotal } = buildModules(plan, evidence, scriptObj);
  // The plan's module total may not equal the narration duration (the v2 plan
  // is duration-hinted, not voice-aligned). Stretch the closing module to
  // cover any narration that runs past the planned end so audio doesn't get
  // cut off mid-sentence at render.
  const tailPad = 0.4;
  const minTotal = voice.totalDurationSec + tailPad;
  let totalDurationSec = planTotal;
  if (planTotal < minTotal && modules.length > 0) {
    const last = modules[modules.length - 1];
    const extra = round(minTotal - planTotal);
    last.durationSec = round(last.durationSec + extra);
    last.endSec = round(last.startSec + last.durationSec);
    totalDurationSec = round(minTotal);
    log('MODULES', `extended last module by ${extra}s to cover narration tail`);
  }
  log('MODULES', `${modules.length} modules; ${totalDurationSec.toFixed(2)}s total`);

  // 4. Story package (the shape prepareRenderProps + generateSubtitles want).
  let storyPackage = {
    story: story.row || story,
    script: scriptObj,
    modules,
    totalDurationSec,
    voice,
    evidencePackage: {
      story_type: storyTypeLong,
      source_documents: (story.row && story.row.source_documents) || evidence.source_documents || [],
      safety_notes: [],
    },
    version: 'v2-bridge',
  };

  // 5. Subtitles (from voice alignment).
  storyPackage = generateSubtitles(storyPackage, outputDir);
  log('SUBTITLES', `${storyPackage.subtitles.length} cues`);

  // 6. Render-props.json (Remotion's CLI props).
  const renderPrep = prepareRenderProps(storyPackage, outputDir);
  log('PROPS', `wrote ${path.relative(APP_ROOT, renderPrep.propsPath).replace(/\\/g, '/')}`);

  // 7. Manifest (consumed by stage 7).
  const outputPath = path.join(outputDir, 'render.mp4');
  const manifest = buildManifest({
    storyId: args.storyId,
    storyPackage,
    propsPath: renderPrep.propsPath,
    outputPath,
  });
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  log('MANIFEST', `wrote ${path.relative(APP_ROOT, manifestPath).replace(/\\/g, '/')}`);

  // 8. Optional Remotion render.
  if (args.skipRender) {
    log('RENDER', 'skipped (--skip-render)');
    return;
  }
  invokeRemotion(renderPrep.propsPath, outputPath);
  log('RENDER', `wrote ${path.relative(APP_ROOT, outputPath).replace(/\\/g, '/')}`);
}

function invokeRemotion(propsPath, outputPath) {
  const remotionEntry = path.join(APP_ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  if (!fs.existsSync(remotionEntry)) {
    throw new Error(`Remotion CLI not found at ${remotionEntry}. Run npm install in video-pipeline-v2.`);
  }
  const args = [
    remotionEntry,
    'render',
    RENDER.entryPoint,
    RENDER.compositionId,
    outputPath,
    `--props=${propsPath}`,
    '--concurrency=1',
    '--log=info',
  ];
  // execFileSync with process.execPath — same pattern as render-video.js. No
  // shell, no metacharacter interpretation; safe with arbitrary file paths.
  execFileSync(process.execPath, args, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    timeout: 600000,
  });
}

function parseArgs(argv) {
  const args = { storyId: null, skipRender: false, dryRun: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--skip-render') {
      args.skipRender = true;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--story-id') {
      args.storyId = argv[++i];
    } else if (a.startsWith('--story-id=')) {
      args.storyId = a.slice('--story-id='.length);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printUsage() {
  process.stdout.write([
    'Usage: node scripts/render-from-plan.js --story-id <id> [options]',
    '',
    'Reads stories/<id>/{story.json, 02_evidence.json, 03_script.md, 04_module-plan.json}',
    'and produces stories/<id>/06_render-output/{render.mp4, manifest.json, ...}.',
    '',
    'Options:',
    '  --story-id <id>   Story workspace under stories/<id>/ (required).',
    '  --skip-render     Build voice+subtitles+props+manifest, skip Remotion CLI.',
    '  --dry-run         Skip ElevenLabs (use synthetic timing). Implies no audio file.',
    '  --help, -h        Show this help.',
    '',
  ].join('\n'));
}

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function log(stage, message) {
  console.log(`[${stage}] ${message}`);
}

function round(v) { return Number(Number(v).toFixed(3)); }

if (require.main === module) {
  main(process.argv).catch((err) => {
    console.error(`[render-from-plan] ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseScriptMarkdown,
  buildModules,
  chooseComponent,
  STORY_TYPE_MAP,
};
