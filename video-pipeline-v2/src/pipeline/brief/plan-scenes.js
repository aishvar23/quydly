'use strict';

// Bridge phase 3 — scene planner with story spine + continuity.
//
// Replaces the per-story-type template ordering (Hook → Numbers →
// Quote → Map → Timeline → Evidence) with a 6-8 scene plan organised
// around the news-story spine that a viewer needs:
//
//   1. Hook — name the event in one simple line
//   2. What happened — the concrete action
//   3. Who is involved — actors and roles (no quote yet)
//   4. Escalation — the consequence
//   5. Timeline — meaningful events with dates
//   6. Why this matters — global / contextual stakes
//   7. What happens next — uncertainty, what to watch
//
// The planner enforces:
//   - No editorial-metadata strings in viewer-facing text (DEVELOPING,
//     "Map context", "Not event footage", "What we cited" all banned).
//   - Quotes only after the speaker has been introduced. If a quote
//     would land in scene 2 (the old QuoteCard slot) without a prior
//     speaker scene, the quote is inlined into scene 3 (Who is
//     involved) with explicit speaker introduction.
//   - Connector narration: each scene 2..N opens with a connector
//     clause linking to the previous scene's idea.
//   - "What we cited" / EvidenceShelf is demoted to a 1-line caption
//     in the closing scene rather than its own 5-second slot.

const { tightenToWords } = require('./generate-video-brief');

const SCENE_PURPOSES = Object.freeze([
  'hook',           // 1
  'what_happened',  // 2
  'who_involved',   // 3
  'escalation',     // 4
  'timeline',       // 5
  'why_matters',    // 6
  'whats_next',     // 7
]);

// Connector phrases per scene transition. The planner picks one based
// on the prior scene's purpose so the narration reads as a continuous
// thought, not seven disconnected sentences.
const CONNECTORS = Object.freeze({
  what_happened: ['Here\'s what happened.', 'On the ground:'],
  who_involved:  ['The players:', 'Four governments are now in the frame.'],
  escalation:    ['The fallout:', 'Then it escalated.'],
  timeline:      ['Here\'s the sequence:', 'How the week unfolded:'],
  why_matters:   ['Why this matters:', 'Zoom out:'],
  whats_next:    ['What to watch:', 'The open question:'],
});

function pickConnector(purpose) {
  const options = CONNECTORS[purpose];
  if (!options || options.length === 0) return '';
  return options[0];
}

// Default scene durations (seconds). Total ~38s for a 7-scene short.
// Tuned per the user's "real short-form news story" target of 35–45s.
const DEFAULT_DURATIONS = Object.freeze({
  hook:          5,
  what_happened: 5,
  who_involved:  6,
  escalation:    5,
  timeline:      6,
  why_matters:   6,
  whats_next:    5,
});

// ── Story-spine extraction ──────────────────────────────────────────────────

// Pick a clear "what happened" sentence — prefers the synth's
// hook_sentence over the headline because the synth tuned the hook
// for spoken delivery. Falls back to the top deduped key_point.
function pickWhatHappened(brief, story) {
  const hook = story?.hook_sentence?.trim();
  if (hook && /\b(closed|closing|opened|attacked|killed|sentenced|won|lost|signed|announced|declared)\b/i.test(hook)) {
    return hook;
  }
  // Find the key point that names a verb event.
  for (const claim of (brief.source_receipts || []).map((r) => r.claim)) {
    if (claim && /\b(closed|attacked|fired|killed|seized|sentenced|won|signed|launched)\b/i.test(claim)) {
      return claim;
    }
  }
  return hook || story?.headline || 'A story is developing.';
}

// Build the "who is involved" scene from primary_entities_enriched.
// Drops the Trump-only framing if multiple persons / orgs are
// involved — surfaces all named actors with their roles.
function buildWhoInvolved(story) {
  const enriched = Array.isArray(story?.primary_entities_enriched)
    ? story.primary_entities_enriched
    : [];
  const persons = enriched.filter((e) => e?.type === 'person');
  const places = enriched.filter((e) => e?.type === 'place');
  const orgs = enriched.filter((e) => e?.type === 'org');
  const actors = [];

  // Pair persons with their roles ("Donald Trump, US President").
  for (const p of persons.slice(0, 4)) {
    if (!p?.name) continue;
    actors.push({
      name: p.name,
      role: p.role || null,
      affiliation: extractCountryFromRole(p.role) || null,
    });
  }
  // Add prominent orgs / agencies.
  for (const o of orgs.slice(0, 2)) {
    if (!o?.name) continue;
    actors.push({ name: o.name, role: o.role || null, affiliation: null });
  }

  return {
    actors,
    places: places.map((p) => p?.name).filter(Boolean),
  };
}

function extractCountryFromRole(role) {
  if (typeof role !== 'string') return null;
  const m = role.match(/\b(US|U\.S\.|United States|Iranian|Pakistan|Indian|Russian|Chinese|Israeli|British|French|German|Saudi|Turkish)\b/i);
  return m ? m[0] : null;
}

// Build a one-line speaker introduction for any verbatim quote in
// the story so the quote scene follows context, not precedes it.
function buildSpeakerIntro(story) {
  const docs = Array.isArray(story?.source_documents) ? story.source_documents : [];
  for (const d of docs) {
    if (d?.quote_text && d?.quote_speaker) {
      const role = d.quote_role ? `, ${d.quote_role}` : '';
      return {
        intro: `${d.quote_speaker}${role}, on the ground:`,
        quote: d.quote_text,
        speaker: d.quote_speaker,
      };
    }
  }
  return null;
}

// ── Why-it-matters / what-next builders ─────────────────────────────────────

// Pulls the synth's why_it_matters (P1-7) when present. Falls back to
// a category-aware default. Critically, this is one full sentence
// shown LATE in the video, not a 1-word "stakes" chip.
function buildWhyMatters(story, evidencePackage) {
  const why = story?.why_it_matters
    || evidencePackage?.why_it_matters
    || null;
  if (typeof why === 'string' && why.trim()) return why.trim();
  const places = (Array.isArray(story?.primary_places) ? story.primary_places : [])
    .map((p) => p?.name)
    .filter(Boolean);
  if (places.length > 0) {
    return `${places[0]} sits at the centre of a wider regional contest.`;
  }
  return 'The story has implications beyond its immediate frame.';
}

// "What happens next" — the open question. The synth doesn't write
// this directly, so we compose from posture + a templated tail. Keep
// it short and honest about uncertainty.
function buildWhatsNext(story) {
  const posture = story?.editorial_posture || null;
  if (posture === 'breaking_developing') {
    return 'The next move could either widen the conflict or force fresh talks.';
  }
  if (posture === 'tally_official' || posture === 'policy_decision') {
    return 'Watch for how the affected parties respond in the coming days.';
  }
  if (posture === 'indictment_alleged') {
    return 'The case is now in the hands of the court; appeals are expected.';
  }
  return 'Watch how this develops in the days ahead.';
}

// ── Scene planner ───────────────────────────────────────────────────────────

function planScenes({ story, evidencePackage, brief }) {
  const what = pickWhatHappened(brief, story);
  const whoInvolved = buildWhoInvolved(story);
  const whyMatters = buildWhyMatters(story, evidencePackage);
  const whatsNext = buildWhatsNext(story);
  const speakerIntro = buildSpeakerIntro(story);
  const developing = brief?.developing_badge || null;

  // Convert the angle places into a clean place phrase ("Strait of
  // Hormuz", "Persian Gulf"). Drives the hook's geographic anchor.
  const places = Array.isArray(story?.primary_places)
    ? story.primary_places.map((p) => p?.name).filter(Boolean)
    : [];
  const primaryPlace = places[0] || null;

  // Build the scenes. Each carries:
  //   - purpose            (slot in the spine)
  //   - onscreen_text      (≤7 words, no editorial labels)
  //   - voiceover          (full spoken sentence with optional connector)
  //   - visual_direction   (what the renderer should show)
  //   - motion_direction   (what should move)
  //   - transition_in      (how this scene opens relative to previous)
  //   - duration_sec
  //   - data               (per-module data for the existing renderer)
  const scenes = [];

  // Scene 1 — Hook. Names the event simply. NO "DEVELOPING" subhead.
  // The developing badge becomes a small corner chip only.
  const hookOnscreen = brief?.hook?.onscreen_text || tightenToWords(what, 7);
  const hookVoiceover = primaryPlace
    ? `${primaryPlace} is back in the headlines for the wrong reasons.`
    : 'A major story is developing.';
  scenes.push({
    purpose: 'hook',
    onscreen_text: hookOnscreen,
    voiceover: hookVoiceover,
    visual_direction: primaryPlace
      ? `wide map zoom from world view down to ${primaryPlace}`
      : 'world map zoom into the affected region',
    motion_direction: 'slow zoom-in over 4s; subtle red overlay on impact area',
    transition_in: 'fade up from black',
    duration_sec: DEFAULT_DURATIONS.hook,
    developing_corner_chip: developing,   // small corner chip only
    data: {
      kicker: places[0] || 'WORLD',
      headline: hookOnscreen,
      // No subhead — the hook line itself does the work.
      // No "DEVELOPING" as primary text.
    },
  });

  // Scene 2 — What happened. Concrete action.
  scenes.push({
    purpose: 'what_happened',
    onscreen_text: tightenToWords(what, 7),
    voiceover: `${pickConnector('what_happened')} ${what}`,
    visual_direction: 'animated lane closure / blockade graphic over the strait',
    motion_direction: 'red shipping lane closes; arrow blocked',
    transition_in: 'crossfade from the map zoom',
    duration_sec: DEFAULT_DURATIONS.what_happened,
    data: {
      headline: tightenToWords(what, 7),
      detail: what,
    },
  });

  // Scene 3 — Who is involved. Names actors with roles. This scene
  // also INTRODUCES any speaker whose quote will appear later, so
  // the quote scene (if present) doesn't drop in cold.
  const actorLines = whoInvolved.actors.slice(0, 4).map((a) => {
    if (a.role) return `${a.name} — ${a.role}`;
    return a.name;
  });
  const whoVoiceover = actorLines.length >= 2
    ? `${pickConnector('who_involved')} ${actorLines.join('; ')}.`
    : `${pickConnector('who_involved')} the actors are still being named.`;
  scenes.push({
    purpose: 'who_involved',
    onscreen_text: tightenToWords(`${whoInvolved.actors.length} parties involved`, 7),
    voiceover: whoVoiceover,
    visual_direction: 'flag + portrait card per actor; staggered reveal',
    motion_direction: 'each actor card slides in with a 200ms stagger',
    transition_in: 'crossfade',
    duration_sec: DEFAULT_DURATIONS.who_involved,
    data: {
      actors: whoInvolved.actors,
      places: whoInvolved.places,
    },
    // The speaker for any quote MUST be in this scene's actor list.
    speakers_introduced: whoInvolved.actors.map((a) => a.name),
  });

  // Scene 4 — Escalation. Concrete consequence. If the story has a
  // verbatim quote, inline it here AFTER the actors are introduced.
  const topReceipt = brief?.source_receipts?.[0]?.claim;
  let escVoiceover = `${pickConnector('escalation')} ${topReceipt || what}`;
  if (speakerIntro && whoInvolved.actors.some((a) => a.name === speakerIntro.speaker)) {
    escVoiceover = `${pickConnector('escalation')} ${speakerIntro.intro} "${speakerIntro.quote}"`;
  }
  scenes.push({
    purpose: 'escalation',
    onscreen_text: tightenToWords(topReceipt || 'Tensions escalate', 7),
    voiceover: escVoiceover,
    visual_direction: 'ship marker flash near chokepoint; warning overlay pulses',
    motion_direction: 'two markers flash (200ms each); red overlay pulse',
    transition_in: 'cut',
    duration_sec: DEFAULT_DURATIONS.escalation,
    data: {
      headline: tightenToWords(topReceipt || 'Tensions escalate', 7),
      detail: topReceipt || '',
      includes_quote: speakerIntro && whoInvolved.actors.some((a) => a.name === speakerIntro.speaker),
    },
  });

  // Scene 5 — Timeline. Meaningful labels with dates animating in.
  // Inherits the brief's timeline (Phase 2 already produces meaningful
  // labels paired with dates). The renderer must animate each entry
  // in sync with the narration, but at the planner level we just hand
  // it the data and direction.
  const timelineEvents = (brief?.timeline_events || []).slice(0, 5);
  if (timelineEvents.length >= 2) {
    scenes.push({
      purpose: 'timeline',
      onscreen_text: tightenToWords('How it unfolded', 7),
      voiceover: `${pickConnector('timeline')} ${timelineEvents.map((e) => e.label).join('; then ')}.`,
      visual_direction: 'each timeline date types in left-to-right with a vertical timeline rail',
      motion_direction: 'date prefix types in (typewriter), label fades in 200ms after; one event per ~1s of narration',
      transition_in: 'wipe from left',
      duration_sec: DEFAULT_DURATIONS.timeline,
      data: {
        events: timelineEvents,
      },
    });
  }

  // Scene 6 — Why this matters. The contextual scene the user
  // explicitly asked for. Replaces the citations-heavy ending.
  scenes.push({
    purpose: 'why_matters',
    onscreen_text: tightenToWords('Why this matters', 7),
    voiceover: `${pickConnector('why_matters')} ${whyMatters}`,
    visual_direction: primaryPlace
      ? `pulsing global shipping route lines emanating from ${primaryPlace}`
      : 'world map with relevant region highlighted; supply-chain arrows',
    motion_direction: 'route lines pulse outward from the hot spot 2x',
    transition_in: 'crossfade',
    duration_sec: DEFAULT_DURATIONS.why_matters,
    data: {
      headline: tightenToWords('Why this matters', 7),
      detail: whyMatters,
    },
  });

  // Scene 7 — What happens next. The honest open question. Replaces
  // the EvidenceShelf "What we cited" closing.
  scenes.push({
    purpose: 'whats_next',
    onscreen_text: tightenToWords('What to watch', 7),
    voiceover: `${pickConnector('whats_next')} ${whatsNext}`,
    visual_direction: 'split-screen showing escalation vs diplomacy paths',
    motion_direction: 'two paths animate in opposing directions; pause on a question mark',
    transition_in: 'crossfade',
    duration_sec: DEFAULT_DURATIONS.whats_next,
    data: {
      headline: tightenToWords('What to watch', 7),
      detail: whatsNext,
    },
    // Source attribution moves to a small bottom strip on this
    // closing scene — visible but secondary, not its own slot.
    source_attribution: (brief?.source_receipts || [])
      .slice(0, 4)
      .map((r) => r.source)
      .join(' · '),
  });

  return {
    scenes,
    total_duration_sec: scenes.reduce((s, sc) => s + (sc.duration_sec || 0), 0),
    speaker_introduced_in_scene_3: scenes[2]?.speakers_introduced || [],
    has_developing_badge: Boolean(developing),
  };
}

module.exports = {
  planScenes,
  pickConnector,
  pickWhatHappened,
  buildWhoInvolved,
  buildSpeakerIntro,
  buildWhyMatters,
  buildWhatsNext,
  SCENE_PURPOSES,
  DEFAULT_DURATIONS,
};
