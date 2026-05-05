'use strict';

// Bridge phase 4 — story-first storyboard generator.
//
// Replaces the generic-card template path. The pipeline is now strict:
//
//   StoryBrief    (already shipped, see brief/generate-video-brief.js)
//        ↓
//   Storyboard    (this module — deterministic scene-by-scene shot list)
//        ↓
//   SceneScript   (narration paired with scene timing)
//        ↓
//   RenderPlan    (maps scene shotTypes to renderer components)
//        ↓
//   RenderValidation  (hard rules; blocks render before MP4)
//
// The storyboard is data, not modules. Each scene declares:
//   - purpose          (slot in the spine)
//   - duration_sec     (target seconds on screen)
//   - onscreen_text    (≤ 7 words; never editorial metadata)
//   - voiceover        (full narration line, with connector clause)
//   - visual {
//       shot_type:     ('globe_zoom' | 'closure_map' | 'four_country_flags' |
//                       'india_impact' | 'pakistan_diplomacy' |
//                       'timeline_typewriter' | 'oil_route_world' | 'split_path_outro')
//       elements:      array of named visual elements the renderer must show
//     }
//   - motion {
//       in:            entry animation
//       during:        sustained animation (so the scene isn't static > 2s)
//       out:           exit / transition
//     }
//   - source_attribution: optional small bottom strip
//
// `shot_type` is the contract with the renderer. If a renderer
// component for that shot_type doesn't exist, the validator MUST
// block the render — otherwise we ship another bad MP4.
//
// The Hormuz storyboard structure follows Codex's exact 8-scene spec.

const SHOT_TYPES = Object.freeze({
  GLOBE_ZOOM:           'globe_zoom',
  CLOSURE_MAP:          'closure_map',
  FOUR_COUNTRY_FLAGS:   'four_country_flags',
  INDIA_IMPACT:         'india_impact',
  PAKISTAN_DIPLOMACY:   'pakistan_diplomacy',
  TIMELINE_TYPEWRITER:  'timeline_typewriter',
  OIL_ROUTE_WORLD:      'oil_route_world',
  SPLIT_PATH_OUTRO:     'split_path_outro',
});

// Per-scene editorial intent. Each is a function so the values can
// pull from synth columns (hook_sentence, why_it_matters, etc.) but
// the structure is fixed.
function buildHormuzStoryboard({ story, brief }) {
  const fourCountries = pickFourCountries(story);
  const indiaImpactClaim = pickIndiaImpactClaim(brief, story);
  const pakistanDiplomacyClaim = pickPakistanDiplomacyClaim(brief, story);
  const timelineEvents = pickTimelineEvents(brief, story);
  const why = pickWhyMatters(story, brief);
  const developing = brief?.developing_badge || null;

  const scenes = [
    // SCENE 1 — Global stakes hook
    {
      scene_number: 1,
      purpose: 'global_stakes_hook',
      duration_sec: 4,
      onscreen_text: 'A major oil route is at risk',
      voiceover: "One of the world's most important oil routes is under threat again.",
      visual: {
        shot_type: SHOT_TYPES.GLOBE_ZOOM,
        elements: [
          { kind: 'globe',                 from: 'world_view' },
          { kind: 'region_zoom',           target: 'Persian Gulf' },
          { kind: 'place_highlight',       target: 'Strait of Hormuz' },
          { kind: 'route_line',            label: 'oil_shipping' },
        ],
      },
      motion: {
        in:     'fade up from black; globe rotates slowly into frame',
        during: '4s zoom: world → Middle East → Persian Gulf → Strait of Hormuz',
        out:    'lock onto chokepoint; route line draws across',
      },
      transition_in:  'fade up from black',
      transition_out: 'continuous zoom into the chokepoint',
      developing_corner_chip: developing,
      source_attribution: null,
    },

    // SCENE 2 — What happened
    {
      scene_number: 2,
      purpose: 'what_happened',
      duration_sec: 5,
      onscreen_text: 'Iran closed the strait',
      voiceover: 'Iran says commercial traffic through the Strait of Hormuz is closed while the US blockade continues.',
      visual: {
        shot_type: SHOT_TYPES.CLOSURE_MAP,
        elements: [
          { kind: 'strait_map',            anchor: 'Strait of Hormuz' },
          { kind: 'closure_zone',          color: 'red' },
          { kind: 'tanker_markers',        count: 3, behaviour: 'slow_to_stop' },
          { kind: 'blockade_marker',       label: 'US naval blockade', anchor: 'Iranian ports' },
        ],
      },
      motion: {
        in:     'wipe right; closure zone fades in',
        during: 'tankers decelerate over 3s; blockade marker pulses 2x',
        out:    'red route line transforms into conflict line',
      },
      transition_in:  'continuous from scene 1 zoom',
      transition_out: 'route line transforms',
      source_attribution: null,
    },

    // SCENE 3 — Who is involved (the four countries)
    {
      scene_number: 3,
      purpose: 'who_involved',
      duration_sec: 6,
      onscreen_text: 'Four countries are now involved',
      voiceover: 'The confrontation centers on the US and Iran, but India and Pakistan have now been pulled into the crisis.',
      visual: {
        shot_type: SHOT_TYPES.FOUR_COUNTRY_FLAGS,
        elements: fourCountries.map((c) => ({
          kind: 'country_card',
          country: c.code,
          flag:    c.flag,
          role:    c.role,
        })),
      },
      motion: {
        in:     'four cards slide in from edges with 200ms stagger',
        during: 'roles type in beneath each flag; connecting lines draw to centre map of Hormuz',
        out:    'lines hold; cards fade slightly to focus next scene',
      },
      transition_in:  'crossfade from conflict line',
      transition_out: 'connecting lines remain',
      source_attribution: null,
    },

    // SCENE 4 — India impact
    {
      scene_number: 4,
      purpose: 'india_impact',
      duration_sec: 5,
      onscreen_text: 'Indian vessels affected',
      voiceover: indiaImpactClaim
        || 'India became involved after two India-linked vessels were reportedly attacked or blocked near the strait.',
      visual: {
        shot_type: SHOT_TYPES.INDIA_IMPACT,
        elements: [
          { kind: 'tanker_marker',   count: 2, flag: 'india' },
          { kind: 'warning_pulse',   anchor: 'Strait of Hormuz' },
          { kind: 'flag_chip',       country: 'india', role: 'affected_party' },
        ],
      },
      motion: {
        in:     'two tanker icons enter from south',
        during: 'tankers approach strait; warning pulse 2x; ships flash red',
        out:    'transition to diplomatic line',
      },
      transition_in:  'pan from country grid to strait',
      transition_out: 'pull back to wider Middle East frame',
      source_attribution: null,
    },

    // SCENE 5 — Pakistan diplomacy
    {
      scene_number: 5,
      purpose: 'pakistan_diplomacy',
      duration_sec: 5,
      onscreen_text: 'Pakistan pushes talks',
      voiceover: pakistanDiplomacyClaim
        || "Pakistan's military leadership warned that the blockade could make peace talks harder.",
      visual: {
        shot_type: SHOT_TYPES.PAKISTAN_DIPLOMACY,
        elements: [
          { kind: 'flag_chip',       country: 'pakistan' },
          { kind: 'diplomatic_line', from: 'Washington', to: 'Tehran' },
          // Balanced hierarchy — no single leader portrait dominates.
          { kind: 'balanced_portrait_pair', countries: ['us', 'pk'] },
        ],
      },
      motion: {
        in:     'flag enters; diplomatic line draws between Washington and Tehran',
        during: 'tension dotted line oscillates; portraits enter at equal weight',
        out:    'fade into timeline rail',
      },
      transition_in:  'crossfade',
      transition_out: 'fade into timeline',
      source_attribution: null,
    },

    // SCENE 6 — Timeline build
    {
      scene_number: 6,
      purpose: 'timeline_build',
      duration_sec: 8,
      onscreen_text: 'How it escalated',
      // Voiceover is the concatenation of the timeline event narrations,
      // synced to the typewriter animations in the renderer.
      voiceover: timelineNarration(timelineEvents),
      visual: {
        shot_type: SHOT_TYPES.TIMELINE_TYPEWRITER,
        elements: [
          { kind: 'timeline_rail' },
          ...timelineEvents.map((e) => ({
            kind: 'timeline_event',
            date: e.date,
            label: e.label,
          })),
        ],
      },
      motion: {
        in:     'timeline rail draws left-to-right',
        during: 'each date types in (typewriter), label fades 200ms after; one event per ~1.5s',
        out:    'timeline compresses back to map',
      },
      transition_in:  'fade in from diplomacy',
      transition_out: 'compression to map',
      source_attribution: null,
    },

    // SCENE 7 — Why this matters
    {
      scene_number: 7,
      purpose: 'why_matters',
      duration_sec: 6,
      onscreen_text: 'Oil prices. Shipping. War risk.',
      voiceover: why
        || 'Hormuz matters because a disruption here can hit energy prices, shipping routes, and the risk of a wider conflict.',
      visual: {
        shot_type: SHOT_TYPES.OIL_ROUTE_WORLD,
        elements: [
          { kind: 'world_map',           with_routes: true },
          { kind: 'oil_route_pulse',     from: 'Persian Gulf', to: 'global' },
          { kind: 'price_indicator',     style: 'subtle' },
          { kind: 'risk_indicator',      style: 'subtle' },
        ],
      },
      motion: {
        in:     'pull out from map to world view',
        during: 'oil route line pulses outward 2x; price/risk indicators tick in background',
        out:    'fade to split-path outro',
      },
      transition_in:  'pull-back zoom',
      transition_out: 'crossfade to split path',
      source_attribution: null,
    },

    // SCENE 8 — What to watch
    {
      scene_number: 8,
      purpose: 'what_to_watch',
      duration_sec: 5,
      onscreen_text: 'Blockade or breakthrough?',
      voiceover: 'The next question is whether the blockade ends, or the crisis spreads beyond the strait.',
      visual: {
        shot_type: SHOT_TYPES.SPLIT_PATH_OUTRO,
        elements: [
          { kind: 'split_screen',  left: 'talks',  right: 'escalation' },
          { kind: 'brand_lockup' },
        ],
      },
      motion: {
        in:     'split-screen wipe',
        during: 'two paths animate in opposing directions; pause on the question mark',
        out:    'brand lockup reveal',
      },
      transition_in:  'split wipe',
      transition_out: 'brand reveal',
      // Sources go here as a small bottom strip — never as a full scene.
      source_attribution: (brief?.source_receipts || [])
        .slice(0, 4)
        .map((r) => r.source)
        .join(' · '),
    },
  ];

  return {
    storyboard_version: 1,
    story_id: story?.id ?? null,
    story_type: 'geopolitics_world',
    template_id: 'hormuz_eight_scene_v1',
    risk_label: brief?.risk_label || null,
    developing_badge: developing,
    scenes,
    total_duration_sec: scenes.reduce((s, sc) => s + (sc.duration_sec || 0), 0),
    // Source list lives here as METADATA. The renderer must NOT make
    // it a full scene; it goes into the video description / caption
    // and a small bottom strip on scene 8.
    sources_metadata: (brief?.source_receipts || []).map((r) => ({
      source: r.source,
      claim:  r.claim,
      url:    r.url,
    })),
  };
}

// ── Source-aware extractors ─────────────────────────────────────────────────

// Pick the four canonical countries for the Hormuz story. Falls back
// to defaults when the synth's primary_places doesn't surface all four.
function pickFourCountries(story) {
  const places = Array.isArray(story?.primary_places) ? story.primary_places : [];
  const placeCodes = new Set(places.map((p) => (p?.code || '').toLowerCase()));
  // The Hormuz story always involves these four; the role copy is
  // editorially anchored, not extracted, because the synth doesn't
  // separately tag "blockade" vs "diplomacy" yet.
  const canonical = [
    { code: 'us', flag: '🇺🇸', role: 'blockade'        },
    { code: 'ir', flag: '🇮🇷', role: 'strait closure'  },
    { code: 'in', flag: '🇮🇳', role: 'vessels affected' },
    { code: 'pk', flag: '🇵🇰', role: 'diplomacy'       },
  ];
  // Mark which ones the synth actually saw. (Doesn't drop any — the
  // story-arc anchor is editorial; presence in primary_places adjusts
  // emphasis but doesn't gate inclusion.)
  return canonical.map((c) => ({
    ...c,
    confirmed_by_synth: placeCodes.has(c.code),
  }));
}

function pickIndiaImpactClaim(brief, story) {
  const claims = (brief?.source_receipts || []).map((r) => r.claim);
  for (const c of claims) {
    if (typeof c === 'string' && /\bindia/i.test(c) && /(vessel|tanker|ship|attack)/i.test(c)) {
      return c;
    }
  }
  // Fall back to a key_point.
  for (const kp of (story?.key_points || [])) {
    if (typeof kp === 'string' && /\bindia/i.test(kp) && /(vessel|tanker|ship|attack)/i.test(kp)) {
      return kp;
    }
  }
  return null;
}

function pickPakistanDiplomacyClaim(brief, story) {
  const candidates = [
    ...(brief?.source_receipts || []).map((r) => r.claim),
    ...(story?.key_points || []),
  ];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    if (/(pakistan|munir)/i.test(c) && /(blockade|peace|talks|diplomacy)/i.test(c)) {
      return c;
    }
  }
  return null;
}

function pickTimelineEvents(brief, story) {
  // Prefer brief.timeline_events (Phase 2 already deduped + paired
  // synth dates with key_point labels).
  if (Array.isArray(brief?.timeline_events) && brief.timeline_events.length > 0) {
    return brief.timeline_events.slice(0, 6).map((e) => ({
      date: e.date || null,
      label: e.label || '',
    }));
  }
  // Fall back to synth's timeline_events directly.
  if (Array.isArray(story?.timeline_events) && story.timeline_events.length > 0) {
    return story.timeline_events.slice(0, 6).map((e) => ({
      date: e.date || null,
      label: e.label || '',
    }));
  }
  return [];
}

function pickWhyMatters(story, brief) {
  return story?.why_it_matters
    || brief?.scenes?.find?.((s) => s.purpose === 'why_matters')?.voiceover
    || null;
}

function timelineNarration(events) {
  if (!events || events.length === 0) {
    return "Here's the sequence.";
  }
  // Concise narration paired with typewriter dates. Prefix each event
  // with its short date prefix; renderer syncs the audio cue to the
  // typewriter animation.
  const parts = events.map((e) => {
    const dateLabel = formatShortDate(e.date);
    return dateLabel ? `${dateLabel}: ${e.label}` : e.label;
  });
  return parts.join('. ') + '.';
}

function formatShortDate(iso) {
  if (typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(m[2]) - 1];
  return `${month} ${Number(m[3])}`;
}

module.exports = {
  buildHormuzStoryboard,
  SHOT_TYPES,
  // Helpers exported for unit tests.
  pickFourCountries,
  pickIndiaImpactClaim,
  pickPakistanDiplomacyClaim,
  pickTimelineEvents,
  timelineNarration,
};
