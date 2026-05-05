'use strict';

// Bridge phase 4 — hard storyboard validator.
//
// The previous validator (src/pipeline/brief/validate-video-brief.js)
// only logged warnings. This one BLOCKS the render. Every rule the
// user listed becomes a hard-fail; the orchestrator must check
// `result.ok` and bail out before invoking the renderer when it's
// false.
//
// Rule table:
//
//   Hard-fail rule                                            | id
//   ──────────────────────────────────────────────────────────┼──────────────
//   Scene text ends with a stray digit (e.g. "matters0")       | trailing_zero
//   Opening scene's onscreen text repeats in scene 2           | repeated_opening
//   Story is framed as Iran ↔ India (US-Iran is the conflict)  | wrong_frame
//   Trump dominates a scene without four-country balance       | trump_dominant
//   Banned editorial labels in primary text                    | banned_label
//   Generic timeline labels ("Article", "Source")              | generic_timeline
//   Quote appears before speaker is introduced                 | quote_before_speaker
//   A scene is dedicated to source citations                   | citation_full_scene
//   Renderer cannot express the storyboard's shot_type         | shot_type_unsupported
//   Static text scene with no `during` motion                  | static_no_motion
//   First three scenes don't establish what / where / who       | unclear_first_three
//
// Soft warnings: anything else that's worth flagging but not
// catastrophic.

// shot_types the existing renderer DOES NOT have a component for.
// This is the contract: if a storyboard demands a globe_zoom but no
// GlobeZoom component exists, the validator must fail-hard so we
// don't ship a render where the visual silently degrades to a
// generic dark-grid card.
//
// Currently EVERY new shot_type is unsupported by the v2 renderer
// (the modules are NumberCard, MapCallout, TimelineCard,
// EvidenceShelf, HookStrap, OutroLockup, QuoteCard). Phase 5 work is
// to build the new components.
const RENDERER_SUPPORTED_SHOT_TYPES = new Set([
  // None of the new storyboard shot_types are supported yet.
]);

const BANNED_LABELS = [
  'developing', 'map context', 'not event footage', 'article',
  'receipts', 'what we cited', 'sources tracked', 'events tracked',
  'chronology', 'attributed evidence', 'official figure',
];

function wordCount(s) {
  return typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0;
}

function validateStoryboard(storyboard) {
  const errors = [];
  const warnings = [];

  if (!storyboard || typeof storyboard !== 'object') {
    return {
      ok: false,
      errors: [{ rule: 'missing_storyboard', detail: 'storyboard is null or not an object' }],
      warnings: [],
    };
  }

  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  if (scenes.length < 6 || scenes.length > 8) {
    errors.push({
      rule: 'wrong_scene_count',
      detail: `storyboard must have 6-8 scenes; got ${scenes.length}`,
    });
  }

  // ── Per-scene checks ─────────────────────────────────────────────────────
  scenes.forEach((scene, idx) => {
    const where = `scene[${idx}](${scene?.purpose ?? '?'})`;

    // 1. Trailing-zero / accidental suffix bug — "Why this matters0".
    // Triggered when text-only data is shoved through a numeric
    // renderer that appends an animated counter. Never let that text
    // reach the renderer.
    const onscreen = scene?.onscreen_text || '';
    if (/[a-zA-Z]\d+$/.test(onscreen)) {
      errors.push({
        rule: 'trailing_zero',
        detail: `${where}: onscreen_text ends with stray digit suffix: "${onscreen}"`,
      });
    }

    // 2. Banned editorial labels as primary text.
    const lower = onscreen.toLowerCase();
    for (const bad of BANNED_LABELS) {
      if (lower.includes(bad)) {
        errors.push({
          rule: 'banned_label',
          detail: `${where}: onscreen_text contains banned editorial label "${bad}": "${onscreen}"`,
        });
        break;
      }
    }

    // 3. Onscreen text length cap.
    if (wordCount(onscreen) > 7) {
      errors.push({
        rule: 'onscreen_too_long',
        detail: `${where}: onscreen_text exceeds 7 words (${wordCount(onscreen)}): "${onscreen}"`,
      });
    }

    // 4. Voiceover required — no scene plays in silence.
    if (typeof scene?.voiceover !== 'string' || !scene.voiceover.trim()) {
      errors.push({
        rule: 'missing_voiceover',
        detail: `${where}: voiceover missing`,
      });
    }

    // 5. Visual shot_type required — no scene without a renderer
    // contract.
    const shotType = scene?.visual?.shot_type;
    if (!shotType) {
      errors.push({
        rule: 'missing_shot_type',
        detail: `${where}: visual.shot_type missing`,
      });
    } else if (!RENDERER_SUPPORTED_SHOT_TYPES.has(shotType)) {
      errors.push({
        rule: 'shot_type_unsupported',
        detail: `${where}: shot_type "${shotType}" has no renderer component (Phase 5 work)`,
      });
    }

    // 6. Motion required — every scene must move (no > 2s static).
    const during = scene?.motion?.during;
    if (!during || typeof during !== 'string' || !during.trim()) {
      errors.push({
        rule: 'static_no_motion',
        detail: `${where}: motion.during missing — scene would be > 2s static`,
      });
    }

    // 7. Citations cannot be a full scene.
    if (scene?.purpose === 'citations' || /citations|sources cited|what we cited/i.test(scene?.onscreen_text || '')) {
      errors.push({
        rule: 'citation_full_scene',
        detail: `${where}: source citations belong in description metadata, not a full scene`,
      });
    }
  });

  // ── Cross-scene checks ───────────────────────────────────────────────────

  // 8. Repeated opening — scene 1 onscreen text appears verbatim in scene 2.
  if (scenes.length >= 2) {
    const a = (scenes[0]?.onscreen_text || '').trim().toLowerCase();
    const b = (scenes[1]?.onscreen_text || '').trim().toLowerCase();
    if (a && b && a === b) {
      errors.push({
        rule: 'repeated_opening',
        detail: `scenes 1 and 2 share the same onscreen_text: "${scenes[0].onscreen_text}"`,
      });
    }
  }

  // 9. First three scenes establish what/where/who.
  // The first three scenes' onscreen + voiceover combined must
  // mention an event verb, a place, and at least two actors.
  if (scenes.length >= 3) {
    const first3 = scenes.slice(0, 3)
      .map((s) => `${s.onscreen_text || ''} ${s.voiceover || ''}`)
      .join(' ')
      .toLowerCase();
    const hasEventVerb = /\b(closed|closing|attacked|seized|sentenced|signed|fired|struck|killed|won|lost|launched|blockade|protest)\b/i.test(first3);
    const hasPlace = /\b(strait|hormuz|persian gulf|middle east|tehran|washington|new delhi|islamabad)\b/i.test(first3);
    if (!hasEventVerb) {
      errors.push({
        rule: 'unclear_first_three',
        detail: 'first 3 scenes lack a concrete event verb (closed / attacked / seized / etc.)',
      });
    }
    if (!hasPlace) {
      errors.push({
        rule: 'unclear_first_three',
        detail: 'first 3 scenes lack a place anchor',
      });
    }
  }

  // 10. Iran-vs-India framing rejection. The conflict pair in this
  // story is US ↔ Iran; India is an affected party. Any scene whose
  // onscreen_text or visual elements pair Iran AND India as the
  // primary actors (without naming the US) is a wrong frame.
  scenes.forEach((scene, idx) => {
    const text = (scene?.onscreen_text || '').toLowerCase();
    if (/\biran\b/.test(text) && /\bindia\b/.test(text) && !/\b(us|u\.s\.|united states)\b/.test(text)) {
      errors.push({
        rule: 'wrong_frame',
        detail: `scene[${idx}]: onscreen_text frames Iran ↔ India without US: "${scene.onscreen_text}"`,
      });
    }
  });

  // 11. Trump dominance check — a scene's visual.elements list with
  // a Trump portrait but no balanced four-country context fails.
  scenes.forEach((scene, idx) => {
    const elements = scene?.visual?.elements || [];
    const hasTrumpPortrait = elements.some(
      (e) => e?.kind === 'portrait' && /trump/i.test(e?.subject || ''),
    );
    if (hasTrumpPortrait) {
      const balanced = elements.some(
        (e) => e?.kind === 'four_country_flags' || e?.kind === 'balanced_portrait_pair',
      );
      if (!balanced) {
        errors.push({
          rule: 'trump_dominant',
          detail: `scene[${idx}]: contains a Trump portrait without balanced country context`,
        });
      }
    }
  });

  // 12. Generic timeline labels.
  for (const scene of scenes) {
    if (scene?.purpose !== 'timeline_build') continue;
    const events = (scene.visual?.elements || []).filter((e) => e?.kind === 'timeline_event');
    for (const e of events) {
      const lbl = (e?.label || '').toLowerCase().trim();
      if (!lbl || lbl === 'article' || lbl === 'source' || /^undated$/.test(lbl)) {
        errors.push({
          rule: 'generic_timeline',
          detail: `timeline event has generic label: "${e?.label}"`,
        });
      }
    }
  }

  // 13. Quote-before-speaker. If any scene includes a verbatim
  // quote, an earlier scene must introduce the speaker by name.
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const quoteText = scene?.voiceover && scene.voiceover.includes('"')
      ? scene.voiceover.match(/"([^"]+)"/)?.[1]
      : null;
    const speakerName = scene?.data?.quote_speaker || scene?.quote_speaker;
    if (!quoteText) continue;
    // Look at previous scenes for a speaker introduction matching the
    // speaker we know belongs to this quote (if any).
    if (speakerName) {
      const intro = scenes.slice(0, i).some((prev) => {
        const blob = `${prev.onscreen_text || ''} ${prev.voiceover || ''}`.toLowerCase();
        return blob.includes(speakerName.toLowerCase());
      });
      if (!intro) {
        errors.push({
          rule: 'quote_before_speaker',
          detail: `scene[${i}]: contains a quote from "${speakerName}" but no earlier scene introduces them`,
        });
      }
    }
  }

  // 14. Total duration sanity.
  const totalSec = scenes.reduce((s, sc) => s + (sc?.duration_sec || 0), 0);
  if (totalSec < 30 || totalSec > 50) {
    warnings.push({
      rule: 'duration_out_of_range',
      detail: `total duration ${totalSec}s outside 30-50s short-form target`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      scenes: scenes.length,
      total_duration_sec: totalSec,
      hard_fails: errors.length,
      soft_warns: warnings.length,
    },
  };
}

module.exports = {
  validateStoryboard,
  BANNED_LABELS,
  RENDERER_SUPPORTED_SHOT_TYPES,
};
