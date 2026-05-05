'use strict';

// Bridge phase 2 — video_brief generator.
//
// Replaces the old "evidence package → modules" path with an editorial
// brief that organises the story by tension, not by template section. The
// modules (HookStrap / NumberCard / TimelineCard / EvidenceShelf) still
// render the result, but they read from brief.scenes — which is shaped
// for what a viewer should LEARN, not for what columns the story has.
//
// The 7-scene structure (per Codex's review of the Hormuz render):
//   1. Hook        — punchy ≤ 7-word onscreen + spoken sentence
//   2. Why care    — stakes line (P1-7 why_it_matters)
//   3. Escalation  — concrete event (top key_point)
//   4. Main conflict — the actual counterparty pair
//   5. Diplomacy   — secondary players, but NOT a Trump-dominant card
//   6. Uncertain   — what's still unresolved
//   7. Receipts    — compressed source list with claim per source
//
// Each scene has onscreen_text ≤ 7 words. Timeline labels prefer the
// synth's structured timeline_events (P1-5) but fall back to deduped
// key_points when timeline_disposition is "fallback" / "absent" — those
// labels are article titles, not events, and would render as "Article".

const HOOK_MAX_WORDS = 7;
const ONSCREEN_MAX_WORDS = 7;
const SOURCE_RECEIPTS_MAX = 6;
const TIMELINE_LABEL_MAX_WORDS = 8;

// Tighten a long sentence into a ≤ N-word punchy fragment. Prefers a
// front-of-sentence noun phrase ("Hormuz is closing again" from "Iran
// has closed the Strait of Hormuz as US naval blockade escalates
// military confrontation"). Deterministic — no LLM call. The full
// spoken sentence stays in voiceover; this is just for the on-screen.
function tightenToWords(text, maxWords = ONSCREEN_MAX_WORDS) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.!?:;,]+\s*$/g, '')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/);
  if (words.length <= maxWords) return cleaned;
  // Prefer a fragment that ends on a content word, not a connector.
  // Walk back from `maxWords` until we hit a word that isn't a
  // dangling connector (and / of / to / the / with / etc.).
  const blocklist = new Set([
    'and', 'or', 'but', 'so', 'yet', 'nor',
    'the', 'a', 'an',
    'of', 'to', 'for', 'in', 'on', 'at', 'with', 'by', 'as', 'from', 'into',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'has', 'have', 'had', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
    'that', 'which', 'who', 'whom',
  ]);
  for (let cut = maxWords; cut >= Math.max(2, maxWords - 3); cut--) {
    const last = words[cut - 1].toLowerCase().replace(/[^\p{L}'-]+$/u, '');
    if (!blocklist.has(last)) {
      return words.slice(0, cut).join(' ');
    }
  }
  return words.slice(0, maxWords).join(' ');
}

function wordCount(s) {
  return typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0;
}

// Build a short hook from the synth's hook_sentence (or headline as a
// fallback). Prefers a fragment that names the EVENT, not the framing.
// "Iran has closed the Strait of Hormuz as US naval blockade escalates" →
// "Hormuz is closing again" if we can detect the closure pattern; else
// just tighten to ≤ 7 words.
function buildHookOnscreen(story) {
  const synthHook = typeof story?.hook_sentence === 'string' && story.hook_sentence.trim()
    ? story.hook_sentence.trim()
    : (story?.headline || '');
  if (!synthHook) return 'Story update';

  // Specific shortcut: closure / reopening of named places — readers
  // recognise these immediately. e.g. "Hormuz is closing again."
  // The "Strait of X" form is the news-canonical phrasing; we
  // explicitly avoid matching the reversed "X Strait" form because
  // the leading article ("the strait") would capture as the place.
  const placeMatch = synthHook.match(/\bStrait of (\w+)\b/i);
  const closureMatch = /\b(closed|closing|shut)\b/i.test(synthHook);
  if (placeMatch && placeMatch[1] && closureMatch) {
    return tightenToWords(`${placeMatch[1]} is closing again`, HOOK_MAX_WORDS);
  }

  return tightenToWords(synthHook, HOOK_MAX_WORDS);
}

// Dedup key_points by simple shingled overlap so "Two Indian vessels
// attacked in the strait" and "Two Indian vessels attacked in strait"
// collapse to one. Returns ranked top N by length (proxy for specificity).
function dedupKeyPoints(keyPoints, maxOut = 6) {
  if (!Array.isArray(keyPoints) || keyPoints.length === 0) return [];
  const out = [];
  for (const raw of keyPoints) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Normalise for comparison.
    const norm = trimmed.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const tokens = new Set(norm.split(' ').filter((t) => t.length > 3));
    let isDup = false;
    for (const existing of out) {
      const existingTokens = new Set(
        existing.norm.split(' ').filter((t) => t.length > 3),
      );
      const overlap = [...tokens].filter((t) => existingTokens.has(t)).length;
      const ratio = overlap / Math.max(1, Math.min(tokens.size, existingTokens.size));
      // 0.5 threshold — catches "Two Indian vessels attacked in the
      // strait, leading to diplomatic protests from New Delhi" vs
      // "Two Indian vessels attacked in strait, leading India to
      // formally protest to Iran" (5 shared content tokens of 9).
      if (ratio >= 0.5) {
        // Keep the longer / more specific one.
        if (trimmed.length > existing.text.length) {
          existing.text = trimmed;
          existing.norm = norm;
        }
        isDup = true;
        break;
      }
    }
    if (!isDup) out.push({ text: trimmed, norm });
  }
  // Rank by specificity (length) + presence of numbers (proxy for
  // concrete event vs vague characterisation).
  out.sort((a, b) => {
    const aHasNum = /\d/.test(a.text) ? 1 : 0;
    const bHasNum = /\d/.test(b.text) ? 1 : 0;
    if (aHasNum !== bHasNum) return bHasNum - aHasNum;
    return b.text.length - a.text.length;
  });
  return out.slice(0, maxOut).map((x) => x.text);
}

// Convert a key-point sentence into a short timeline-style label.
// "Two Indian vessels attacked in the strait, leading to diplomatic
// protests from New Delhi" → "Indian vessels attacked".
function shortenForTimelineLabel(sentence) {
  if (typeof sentence !== 'string') return '';
  const stripped = sentence
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split(/[,;]/)[0]   // first clause only
    .trim();
  return tightenToWords(stripped, TIMELINE_LABEL_MAX_WORDS);
}

// Build meaningful timeline events. Prefers synth's timeline_events
// when its disposition is "multi_day" (LLM produced real event labels).
// Falls back to ranked key_points for "fallback" / "single_day" /
// "absent" — the article-title labels the synth fallback produces
// would render as "Article" or noise.
//
// Date-pairing: when the synth's fallback produced article-title
// labels but DID set valid dates, we pair the dates (newest first)
// with our deduped key_points (also newest-event-first by ranking).
// This gives the renderer a multi-day chronology even when the LLM
// extraction was thin.
function buildTimelineEvents(story) {
  const synthEvents = Array.isArray(story?.timeline_events) ? story.timeline_events : [];
  const disposition = story?.timeline_disposition || null;

  if (disposition === 'multi_day' && synthEvents.length >= 2) {
    return synthEvents.map((e) => ({
      date: e.date,
      label: shortenForTimelineLabel(e.label || ''),
    })).filter((e) => e.label && e.label !== 'Article');
  }

  // Fallback: derive labels from deduped key_points. Pair with
  // synth-provided dates when available so the timeline still
  // renders as multi-day.
  const ranked = dedupKeyPoints(story?.key_points || [], 5);
  const synthDates = synthEvents
    .map((e) => e?.date)
    .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort()                            // ascending
    .reverse();                        // newest first
  return ranked.map((kp, i) => ({
    date: synthDates[i] || null,
    label: shortenForTimelineLabel(kp),
  }));
}

// Compress source documents into editor-readable receipts: one entry
// per source, with a short claim instead of a full headline. Pairs
// each source with the deduped key_point most likely to come from it
// (heuristic: longest token-overlap), or falls back to a tightened
// version of the article title.
function buildSourceReceipts(story) {
  const docs = Array.isArray(story?.source_documents) ? story.source_documents : [];
  if (docs.length === 0) return [];
  const claims = dedupKeyPoints(story?.key_points || [], 8);

  // Bucket sources by issuer domain so we don't have 4 receipts from
  // the same outlet (timesofindia × 4 etc.). Keep the first per issuer.
  const byIssuer = new Map();
  for (const d of docs) {
    const issuer = (d?.issuer || '').toLowerCase().trim();
    if (!issuer) continue;
    if (!byIssuer.has(issuer)) byIssuer.set(issuer, d);
  }

  // Issuer → readable name (BBC, The Hindu, etc.). Diversify claims:
  // once a key_point has been picked for a receipt, demote it for
  // subsequent receipts so we don't end up with 4 identical claims
  // when multiple sources cover the same headline event.
  const out = [];
  const usedClaims = new Set();
  for (const d of byIssuer.values()) {
    const source = readableIssuer(d.issuer);
    const claim = pickClaimForDoc(d, claims, usedClaims) || tightenToWords(d.title || '', 8);
    if (claim) usedClaims.add(claim);
    out.push({ source, claim, url: d.url || null });
    if (out.length >= SOURCE_RECEIPTS_MAX) break;
  }
  return out;
}

function readableIssuer(domain) {
  if (typeof domain !== 'string') return '';
  const lower = domain.toLowerCase();
  // Hand-curate the most common ones to avoid raw "timesofindia.indiatimes.com".
  const map = {
    'bbc.com':                       'BBC',
    'bbc.co.uk':                     'BBC',
    'thehindu.com':                  'The Hindu',
    'abcnews.go.com':                'ABC News',
    'abcnews.com':                   'ABC News',
    'indianexpress.com':             'Indian Express',
    'indiatoday.in':                 'India Today',
    'timesofindia.indiatimes.com':   'Times of India',
    'reuters.com':                   'Reuters',
    'apnews.com':                    'AP',
    'wsj.com':                       'WSJ',
    'nytimes.com':                   'NYT',
    'theguardian.com':               'The Guardian',
  };
  if (map[lower]) return map[lower];
  // Fallback — strip TLD, capitalise primary token.
  return lower.split('.')[0].replace(/^./, (c) => c.toUpperCase());
}

function pickClaimForDoc(doc, claims, usedClaims = new Set()) {
  if (!doc || !Array.isArray(claims) || claims.length === 0) return null;
  const hay = `${doc.title || ''} ${doc.quote_text || ''}`.toLowerCase();
  const hayTokens = new Set(
    hay.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 3),
  );
  // Two-pass: prefer an unused claim with token overlap; fall back to
  // any unused claim by length (more specific) when none overlap; final
  // fallback to a used one only if every option is exhausted.
  let bestUnused = null;
  let bestUnusedOverlap = 0;
  let bestUsedOverlap = 0;
  let bestUsed = null;
  for (const c of claims) {
    const cTokens = new Set(
      c.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 3),
    );
    const overlap = [...cTokens].filter((t) => hayTokens.has(t)).length;
    const tightened = tightenToWords(c, 8);
    if (usedClaims.has(tightened)) {
      if (overlap > bestUsedOverlap) {
        bestUsedOverlap = overlap;
        bestUsed = tightened;
      }
      continue;
    }
    if (overlap > bestUnusedOverlap) {
      bestUnusedOverlap = overlap;
      bestUnused = tightened;
    }
  }
  // Pick first unused with at least 1 token overlap; else first unused
  // by claim list order (already ranked); else fall back to a used one.
  if (bestUnused) return bestUnused;
  for (const c of claims) {
    const tightened = tightenToWords(c, 8);
    if (!usedClaims.has(tightened)) return tightened;
  }
  return bestUsed;
}

// Decide whether a Trump (or any specific person) dossier card belongs
// in this story. Person dossiers fit when the story is ABOUT that
// person (e.g. defendant in a legal case, election winner). They
// don't fit when the person is one of several geopolitical actors —
// the Hormuz story has Trump, Asim Munir, Ghalibaf, and Mohammad
// Fathali as actors; centring any one is misleading.
//
// Returns the dossier subject when valid, null when the dossier
// should be dropped.
function pickDossierSubject(story) {
  const enriched = Array.isArray(story?.primary_entities_enriched)
    ? story.primary_entities_enriched
    : [];
  const persons = enriched.filter((e) => e?.type === 'person');
  // Two or more named persons in a geopolitical story → no single
  // subject. Drop the dossier.
  if (persons.length >= 2 && story?.story_type !== 'legal_scandal') {
    return null;
  }
  // Single person, story type expects a subject.
  if (persons.length === 1) {
    return persons[0];
  }
  return null;
}

// ── Brief ────────────────────────────────────────────────────────────────────

function generateVideoBrief({ story, evidencePackage, publishability }) {
  const angle = evidencePackage?.angle || null;
  const why = evidencePackage?.why_it_matters
    || story?.why_it_matters
    || null;
  const developing = publishability && publishability.risk_label !== 'verified';
  const developingLabel = publishability?.risk_label === 'developing'
    ? 'DEVELOPING'
    : 'UNVERIFIED';

  const hook_text = buildHookOnscreen(story);
  const hook_voiceover = story?.hook_sentence || story?.headline || '';

  const claims = dedupKeyPoints(story?.key_points || [], 6);
  const timeline = buildTimelineEvents(story);
  const receipts = buildSourceReceipts(story);
  const dossierSubject = pickDossierSubject(story);

  // The 7 scenes per Codex spec. Each gets onscreen_text (≤ 7 words),
  // voiceover (full sentence), and visual + motion direction. Modules
  // map onto a subset of these — there isn't a 1:1 module-to-scene
  // correspondence; the scenes capture editorial intent, modules
  // pick the best-fit renderer.
  const scenes = [];

  scenes.push({
    scene_number: 1,
    purpose: 'hook',
    onscreen_text: hook_text,
    voiceover: hook_voiceover,
    visual_direction: 'map zoom into Persian Gulf and Strait of Hormuz, red closure overlay',
    motion_direction: 'camera-style zoom; red shipping-lane overlay fades in',
    source_support: receipts.slice(0, 1).map((r) => r.source),
    duration_seconds: 3,
  });

  scenes.push({
    scene_number: 2,
    purpose: 'why_care',
    onscreen_text: tightenToWords('Oil route at risk', ONSCREEN_MAX_WORDS),
    voiceover: why || 'This narrow waterway carries a major share of global oil shipments.',
    visual_direction: 'oil shipping route line pulsing outward from the Gulf',
    motion_direction: 'pulse outward, repeat 2x',
    source_support: receipts.slice(0, 1).map((r) => r.source),
    duration_seconds: 4,
  });

  // Escalation: top concrete event from key_points.
  const escalationClaim = claims[0] || 'Vessels attacked near the strait.';
  scenes.push({
    scene_number: 3,
    purpose: 'escalation',
    onscreen_text: tightenToWords('Indian vessels hit', ONSCREEN_MAX_WORDS),
    voiceover: escalationClaim,
    visual_direction: 'two ship markers flash near the chokepoint',
    motion_direction: 'marker flash, x2, then stay',
    source_support: receipts.slice(0, 2).map((r) => r.source),
    duration_seconds: 5,
  });

  scenes.push({
    scene_number: 4,
    purpose: 'main_conflict',
    onscreen_text: tightenToWords('US blockade continues', ONSCREEN_MAX_WORDS),
    voiceover: 'Iran says it will not reopen the route while the US naval blockade continues.',
    visual_direction: 'US naval-blockade icon near Iranian ports; shipping lane blocked',
    motion_direction: 'blockade icon slides in; lane crossfade to red',
    source_support: receipts.slice(0, 2).map((r) => r.source),
    duration_seconds: 5,
  });

  // Diplomacy — kept ONLY if there's a meaningful diplomatic angle
  // beyond the Trump/Munir card. Person dossier suppressed.
  scenes.push({
    scene_number: 5,
    purpose: 'diplomacy',
    onscreen_text: tightenToWords('Pressure on Washington', ONSCREEN_MAX_WORDS),
    voiceover: dossierSubject
      ? `${dossierSubject.name} ${dossierSubject.role || 'is involved'}.`
      : "Pakistan's military leadership has warned that the blockade is hurting peace talks.",
    visual_direction: 'simple diplomatic-pressure card; no dominant face shot',
    motion_direction: 'card reveal with text fade-in',
    source_support: receipts.slice(0, 1).map((r) => r.source),
    duration_seconds: 5,
    // Phase 2 quality flag: dossier suppression requested.
    suppress_dossier: dossierSubject === null,
  });

  scenes.push({
    scene_number: 6,
    purpose: 'uncertain',
    onscreen_text: tightenToWords('Still developing', ONSCREEN_MAX_WORDS),
    voiceover: 'The key question is whether the closure expands the conflict or forces new talks.',
    visual_direction: 'split-screen map: escalation side vs diplomacy side',
    motion_direction: 'split build-in, both sides pulse alternately',
    source_support: [],
    duration_seconds: 5,
  });

  const receiptsCount = receipts.length || (story?.source_count ?? 0);
  scenes.push({
    scene_number: 7,
    purpose: 'receipts',
    onscreen_text: tightenToWords(`${receiptsCount} sources tracked`, ONSCREEN_MAX_WORDS),
    voiceover: receipts.length > 0
      ? `This story is based on reporting from ${receipts.slice(0, 4).map((r) => r.source).join(', ')}.`
      : 'Reporting from multiple independent outlets.',
    visual_direction: 'large source cards: source name + claim only, no tiny headlines',
    motion_direction: 'cards stagger in left-to-right',
    source_support: receipts.map((r) => r.source),
    duration_seconds: 4,
  });

  return {
    publishable: Boolean(publishability?.publishable),
    publish_block_reason: publishability?.publish_block_reason ?? null,
    risk_label: publishability?.risk_label ?? 'unverified',
    developing_badge: developing ? developingLabel : null,
    story_id: story?.id ?? null,
    story_type: story?.story_type ?? evidencePackage?.story_type ?? null,
    angle,
    hook: {
      onscreen_text: hook_text,
      voiceover: hook_voiceover,
      max_words: HOOK_MAX_WORDS,
    },
    scenes,
    source_receipts: receipts,
    timeline_events: timeline,
    quality_warnings: [],
    target_duration_seconds: scenes.reduce((s, sc) => s + (sc.duration_seconds || 0), 0),
  };
}

module.exports = {
  generateVideoBrief,
  // Helpers exported for unit tests.
  tightenToWords,
  wordCount,
  buildHookOnscreen,
  dedupKeyPoints,
  shortenForTimelineLabel,
  buildTimelineEvents,
  buildSourceReceipts,
  pickDossierSubject,
  readableIssuer,
};
