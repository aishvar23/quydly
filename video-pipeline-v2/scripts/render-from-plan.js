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

// ─── primary country resolution ──────────────────────────────────────────────
// Pick the highest-confidence country from the story's geo signals. Logic:
//   1. row.geo_scores: country with score ≥ 0.5 (pick max). Skip 'global'.
//   2. fallback: row.primary_geos[0].
//   3. else: null.
// Returns { code, name, flag_emoji } or null. Crash loudly only on malformed
// shape — null is a legitimate result for stories with no geo signal.
//
// NOTE: geo_scores keys are mixed-case country *names* (e.g. "india", "global"),
// while primary_geos are ISO-2 codes (e.g. "in"). We bridge via NAME_TO_CODE.

const COUNTRY_CODE_TO_NAME = {
  in: 'India',          bd: 'Bangladesh',     pk: 'Pakistan',
  lk: 'Sri Lanka',      np: 'Nepal',          cn: 'China',
  jp: 'Japan',          kr: 'South Korea',    kp: 'North Korea',
  tw: 'Taiwan',         hk: 'Hong Kong',      sg: 'Singapore',
  my: 'Malaysia',       id: 'Indonesia',      ph: 'Philippines',
  th: 'Thailand',       vn: 'Vietnam',        us: 'United States',
  ca: 'Canada',         mx: 'Mexico',         br: 'Brazil',
  ar: 'Argentina',      ve: 'Venezuela',      co: 'Colombia',
  cl: 'Chile',          pe: 'Peru',           gb: 'United Kingdom',
  uk: 'United Kingdom', ie: 'Ireland',        fr: 'France',
  de: 'Germany',        it: 'Italy',          es: 'Spain',
  pt: 'Portugal',       nl: 'Netherlands',    be: 'Belgium',
  ch: 'Switzerland',    at: 'Austria',        pl: 'Poland',
  se: 'Sweden',         no: 'Norway',         dk: 'Denmark',
  fi: 'Finland',        is: 'Iceland',        gr: 'Greece',
  tr: 'Turkey',         ru: 'Russia',         ua: 'Ukraine',
  by: 'Belarus',        ro: 'Romania',        cz: 'Czech Republic',
  hu: 'Hungary',        il: 'Israel',         ps: 'Palestinian Territories',
  ir: 'Iran',           sa: 'Saudi Arabia',   ae: 'United Arab Emirates',
  qa: 'Qatar',          eg: 'Egypt',          za: 'South Africa',
  ng: 'Nigeria',        ke: 'Kenya',          et: 'Ethiopia',
  au: 'Australia',      nz: 'New Zealand',
};

// Regional indicator letter offset trick: ISO-2 → 🇽🇽 emoji.
function flagEmojiFromCode(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const A = 0x1F1E6;
  const a = 'a'.charCodeAt(0);
  const c0 = code.toLowerCase().charCodeAt(0);
  const c1 = code.toLowerCase().charCodeAt(1);
  if (c0 < a || c0 > a + 25 || c1 < a || c1 > a + 25) return '';
  return String.fromCodePoint(A + (c0 - a)) + String.fromCodePoint(A + (c1 - a));
}

function resolvePrimaryCountry(row) {
  if (!row || typeof row !== 'object') return null;
  const codeOf = (name) => {
    const n = String(name || '').toLowerCase();
    for (const [code, full] of Object.entries(COUNTRY_CODE_TO_NAME)) {
      if (full.toLowerCase() === n) return code;
    }
    return null;
  };

  const scores = row.geo_scores;
  if (scores && typeof scores === 'object') {
    let bestCode = null;
    let bestScore = 0;
    for (const [name, score] of Object.entries(scores)) {
      if (name === 'global') continue;
      const numeric = Number(score);
      if (!Number.isFinite(numeric) || numeric < 0.5) continue;
      const code = codeOf(name);
      if (code && numeric > bestScore) {
        bestScore = numeric;
        bestCode  = code;
      }
    }
    if (bestCode) {
      return { code: bestCode, name: COUNTRY_CODE_TO_NAME[bestCode], flag_emoji: flagEmojiFromCode(bestCode) };
    }
  }

  // Fallback: first primary_geos code with a known name.
  const geos = Array.isArray(row.primary_geos) ? row.primary_geos : [];
  for (const raw of geos) {
    const code = String(raw || '').toLowerCase();
    if (COUNTRY_CODE_TO_NAME[code]) {
      return { code, name: COUNTRY_CODE_TO_NAME[code], flag_emoji: flagEmojiFromCode(code) };
    }
  }

  // TODO(stage-5): warn when primary_country is null AND geo_scores empty AND
  // primary_geos empty — that's a real data gap the renderer can't paint over.
  return null;
}

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

  // Hook overlay rescue: stage-4 sometimes truncates the hook to a fragment
  // ("New Delhi named BJP leader Dinesh Trivedi" — no object). When the plan
  // text is a strict prefix of the script's hook segment AND lacks terminal
  // punctuation, swap in the script's full hook sentence so the on-frame
  // copy reads as a complete proposition.
  const hookSegment = scriptObj.segments.find((s) => s.role === 'hook');
  const hookSegmentText = hookSegment ? hookSegment.text.trim() : '';

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

    let overlayText = String(m.text || '').trim();
    const narration = segment ? segment.text : overlayText;
    let hookOverlayNote = null;

    if (
      choice.role === 'hook'
      && hookSegmentText
      && overlayText
      && !/[.!?]$/.test(overlayText)
      && hookSegmentText.startsWith(overlayText)
      && hookSegmentText.length > overlayText.length
    ) {
      hookOverlayNote = `hook overlay extended from plan fragment to script sentence (was: "${overlayText}")`;
      overlayText = hookSegmentText;
    }

    const data = {};
    if (m.numeric_fact_ref) {
      const nf = numericById.get(m.numeric_fact_ref);
      if (nf) {
        // NumberCard reads `count`/`label` from data. `secondary` and
        // `sourceCitation` were leaking editorial provenance / per-module
        // citation chips on every frame — the renderer's gates fall through
        // to empty when these are unset, which is the correct viewer state.
        // Sources stay only on the end card (manifest end-card block).
        data.count = String(nf.value);
        data.label = String(nf.unit || '');
      }
    }

    const startSec = round(cursor);
    const endSec   = round(startSec + duration);

    const notes = [];
    if (choice.note) notes.push(choice.note);
    if (hookOverlayNote) notes.push(hookOverlayNote);
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
        // Snapshot of the plan duration before any voice-overrun
        // redistribution; manifest_duration reflects what actually rendered.
        planned_duration_sec: round(duration),
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
      planned_duration: round(ref.planned_duration_sec ?? m.durationSec),
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
  // Reconcile plan vs actual narration. ElevenLabs usually reads slower than
  // stage-4 plans (~120-145 wpm vs 165 plan-side), so voice overruns by
  // 10-20s on most stories. The previous bridge dumped the entire overrun
  // onto the last module (the close), producing 26s of static OutroLockup
  // after content ended. New policy:
  //   - cap close drift at +2.0s above planned
  //   - distribute the rest across the last 2-3 BODY modules (proportional)
  //   - trim close to voice_end_within_close + 1.5s if narration ends early
  //   - render total = voice + 1.5s tail; no static beyond that
  const TAIL_PAD = 1.5;
  const CLOSE_MAX_DRIFT = 2.0;
  const requiredTotal = voice.totalDurationSec + TAIL_PAD;
  let totalDurationSec = planTotal;
  let redistributionLog = null;

  if (modules.length > 0 && requiredTotal > planTotal) {
    const overrun = round(requiredTotal - planTotal);
    const closeIdx = modules.length - 1;
    const closePlanned = modules[closeIdx].durationSec;

    const closeDelta = Math.min(CLOSE_MAX_DRIFT, overrun);
    const bodyDelta = round(overrun - closeDelta);

    // Pick last 2-3 body modules (exclude close). Fewer if plan is short.
    const bodyTail = [];
    for (let i = closeIdx - 1; i >= 0 && bodyTail.length < 3; i--) bodyTail.push(i);

    if (bodyDelta > 0 && bodyTail.length > 0) {
      // Proportional to current planned duration so already-long body beats
      // absorb proportionally more — keeps pacing roughly intact.
      const totalWeight = bodyTail.reduce((s, i) => s + modules[i].durationSec, 0);
      let assigned = 0;
      for (let k = 0; k < bodyTail.length; k++) {
        const i = bodyTail[k];
        const isLast = k === bodyTail.length - 1;
        const share = isLast
          ? round(bodyDelta - assigned)
          : round((modules[i].durationSec / totalWeight) * bodyDelta);
        modules[i].durationSec = round(modules[i].durationSec + share);
        assigned = round(assigned + share);
      }
    } else if (bodyDelta > 0) {
      // No body modules — fold residue into close (single-module plans).
      modules[closeIdx].durationSec = round(modules[closeIdx].durationSec + bodyDelta);
    }
    modules[closeIdx].durationSec = round(closePlanned + closeDelta);

    redistributionLog = `voice +${overrun}s; close +${closeDelta}s, body +${bodyDelta}s across last ${bodyTail.length}`;
  }

  // Recompute startSec / endSec after any duration changes.
  let cursor = 0;
  for (const m of modules) {
    m.startSec = round(cursor);
    m.endSec = round(cursor + m.durationSec);
    cursor = m.endSec;
  }
  totalDurationSec = round(cursor);

  // Trim close: if narration ends within the close beat earlier than the
  // close end, render only voice_end_in_close + 1.5s. Stops the OutroLockup
  // from holding static logo for any meaningful time after audio.
  if (modules.length > 0) {
    const close = modules[modules.length - 1];
    const voiceEndInClose = round(voice.totalDurationSec - close.startSec);
    if (voiceEndInClose >= 0) {
      const trimmedDuration = round(Math.min(close.durationSec, voiceEndInClose + TAIL_PAD));
      if (trimmedDuration < close.durationSec) {
        close.durationSec = trimmedDuration;
        close.endSec = round(close.startSec + trimmedDuration);
        totalDurationSec = close.endSec;
      }
    }
  }

  if (redistributionLog) log('MODULES', redistributionLog);
  log('MODULES', `${modules.length} modules; ${totalDurationSec.toFixed(2)}s total (voice ${voice.totalDurationSec.toFixed(2)}s + tail)`);

  // 4. Story package (the shape prepareRenderProps + generateSubtitles want).
  // Resolve the unambiguous primary country (geo_scores ≥ 0.5, else first
  // primary_geos) so the renderer can paint a persistent "<flag> <COUNTRY>
  // NEWS" banner. null when the row has no resolvable geo signal.
  const storyRow = story.row || story;
  const primaryCountry = resolvePrimaryCountry(storyRow);
  const augmentedStory = { ...storyRow, primary_country: primaryCountry };
  let storyPackage = {
    story: augmentedStory,
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
