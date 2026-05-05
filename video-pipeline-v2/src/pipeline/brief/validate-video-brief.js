'use strict';

// Bridge phase 2 — video_brief validation pass.
//
// Per Codex's review, fail the brief BEFORE render when:
//   - opening hook is too long / article-style
//   - any onscreen_text exceeds 7 words
//   - timeline labels are generic ("Article", "Source", etc.)
//   - a person-dossier card is present when no single subject dominates
//   - source receipts are missing
//   - story is unverified but no DEVELOPING badge is visible in scene 1
//   - any scene has visual_direction that's just "show news background"
//
// Returns:
//   {
//     ok: bool,
//     errors: string[],     // hard rejections
//     warnings: string[],   // soft signals (don't block render but log)
//   }

const ONSCREEN_MAX_WORDS = 7;
const TIMELINE_BAD_LABELS = new Set([
  'article', 'articles', 'source', 'sources', 'reporting',
  'event', 'events', 'undated',
]);

const GENERIC_VISUAL_PHRASES = [
  'show news background',
  'news graphic',
  'static text',
  'plain card',
  'background only',
];

function wordCount(s) {
  return typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0;
}

function validateVideoBrief(brief) {
  const errors = [];
  const warnings = [];

  if (!brief || typeof brief !== 'object') {
    return { ok: false, errors: ['brief is missing or not an object'], warnings: [] };
  }

  // Hook length.
  const hookText = brief.hook?.onscreen_text;
  if (typeof hookText !== 'string' || !hookText.trim()) {
    errors.push('hook.onscreen_text missing');
  } else if (wordCount(hookText) > ONSCREEN_MAX_WORDS) {
    errors.push(
      `hook.onscreen_text exceeds ${ONSCREEN_MAX_WORDS} words: "${hookText}" (${wordCount(hookText)})`,
    );
  }

  // Per-scene checks.
  if (!Array.isArray(brief.scenes) || brief.scenes.length === 0) {
    errors.push('brief.scenes missing or empty');
  } else {
    brief.scenes.forEach((scene, idx) => {
      const where = `scenes[${idx}](${scene?.purpose ?? '?'})`;
      if (typeof scene?.onscreen_text !== 'string' || !scene.onscreen_text.trim()) {
        errors.push(`${where}: onscreen_text missing`);
      } else if (wordCount(scene.onscreen_text) > ONSCREEN_MAX_WORDS) {
        errors.push(
          `${where}: onscreen_text exceeds ${ONSCREEN_MAX_WORDS} words: "${scene.onscreen_text}" (${wordCount(scene.onscreen_text)})`,
        );
      }
      if (typeof scene?.voiceover !== 'string' || !scene.voiceover.trim()) {
        errors.push(`${where}: voiceover missing`);
      }
      // Visual direction must not be generic.
      const vd = (scene?.visual_direction || '').toLowerCase();
      if (!vd) {
        errors.push(`${where}: visual_direction missing`);
      } else if (GENERIC_VISUAL_PHRASES.some((p) => vd.includes(p))) {
        errors.push(`${where}: visual_direction is generic ("${scene.visual_direction}")`);
      }
      // Motion direction required so renderer can avoid > 3s static.
      if (!scene?.motion_direction || !String(scene.motion_direction).trim()) {
        warnings.push(`${where}: motion_direction missing — renderer must add motion or static will exceed 3s`);
      }
    });
  }

  // Timeline event labels — must not be "Article" or other generic placeholders.
  if (Array.isArray(brief.timeline_events)) {
    brief.timeline_events.forEach((te, idx) => {
      const lbl = (te?.label || '').toLowerCase().trim();
      if (!lbl) {
        errors.push(`timeline_events[${idx}]: label missing`);
      } else if (TIMELINE_BAD_LABELS.has(lbl)) {
        errors.push(`timeline_events[${idx}]: label is generic ("${te.label}")`);
      }
    });
  }

  // Source receipts must be present and shaped {source, claim}.
  if (!Array.isArray(brief.source_receipts) || brief.source_receipts.length === 0) {
    errors.push('source_receipts missing');
  } else {
    brief.source_receipts.forEach((r, idx) => {
      if (!r?.source || typeof r.source !== 'string') {
        errors.push(`source_receipts[${idx}]: source missing`);
      }
      if (!r?.claim || typeof r.claim !== 'string') {
        errors.push(`source_receipts[${idx}]: claim missing`);
      }
    });
  }

  // Trump-domination check — if any scene mentions Trump prominently in
  // its onscreen_text but Trump isn't the primary frame, fail.
  // "Primary frame" = story_type is 'legal_scandal' (defendant flow) OR
  // angle.primary_actors[0] is Donald Trump.
  const angleActors = brief?.angle?.primary_actors || [];
  const trumpIsPrimary = (angleActors[0] || '').toLowerCase().includes('donald trump')
    || (brief?.story_type === 'legal_scandal' && angleActors.some((a) => /trump/i.test(a)));
  if (!trumpIsPrimary && Array.isArray(brief.scenes)) {
    for (const scene of brief.scenes) {
      const onscreen = scene?.onscreen_text || '';
      if (/\btrump\b/i.test(onscreen)) {
        errors.push(
          `scene "${scene.purpose}" has Trump on-screen but Trump is not the primary frame (angle.primary_actors=${JSON.stringify(angleActors.slice(0, 3))})`,
        );
      }
    }
  }

  // DEVELOPING / UNVERIFIED badge presence.
  if (brief.risk_label && brief.risk_label !== 'verified') {
    if (!brief.developing_badge) {
      errors.push(`risk_label="${brief.risk_label}" but developing_badge is null`);
    }
    // Scene 1 must signal it visually. The brief carries the badge
    // as a top-level field; the renderer is responsible for showing it
    // in the first 3 seconds. We just check the field is non-null.
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  validateVideoBrief,
  ONSCREEN_MAX_WORDS,
  TIMELINE_BAD_LABELS,
  wordCount,
};
