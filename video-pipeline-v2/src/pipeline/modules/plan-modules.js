'use strict';

const { getTypeById } = require('../understand/story-types');

// Pure planner. Pulls the type's template, then aligns module timings to the
// voice alignment so the visual transitions match the audio segment that's
// being read. Falls back to proportional scaling when no voice alignment.
function planModules({ story, evidencePackage, script, voice }) {
  const type = getTypeById(evidencePackage.story_type);
  if (!type) {
    throw new Error(`Unknown story_type "${evidencePackage.story_type}"`);
  }

  const rawTemplate = type.template(evidencePackage, script);
  if (!Array.isArray(rawTemplate) || rawTemplate.length === 0) {
    throw new Error('Type template returned no modules');
  }

  const templateModules = applyVoiceTimings(rawTemplate, script, voice);
  const narrationDuration = Math.max(
    voice?.totalDurationSec || 0,
    script.estimated_duration_sec || 0,
    20,
  );

  // Proportional scaling parameters used as fallback when a module has no
  // alignment-derived timing.
  const fixedRoles = new Set(['hook', 'outro']);
  const flex = templateModules.filter((m) => !fixedRoles.has(m.role) && !hasExactTiming(m));
  const fixedTotal = templateModules
    .filter((m) => fixedRoles.has(m.role) && !hasExactTiming(m))
    .reduce((sum, m) => sum + (m.durationHintSec || 3.6), 0);
  const flexHintTotal = flex.reduce((sum, m) => sum + (m.durationHintSec || 5), 0);
  const flexBudget = Math.max(narrationDuration - fixedTotal, flex.length * 3);
  const scale = flexHintTotal > 0 ? flexBudget / flexHintTotal : 1;

  let cursor = 0;
  const planned = templateModules.map((module, idx) => {
    const hint = module.durationHintSec || 5;
    const min = module.minDurationSec || 3.0;
    const max = module.maxDurationSec || 7.0;
    const isFixed = fixedRoles.has(module.role);
    const exact = hasExactTiming(module);
    const startSec = exact ? module.startSec : cursor;
    const durationSec = exact
      ? module.durationSec
      : (isFixed ? hint : clamp(hint * scale, min, max));

    const result = {
      moduleId: idx + 1,
      role: module.role,
      componentType: module.componentType,
      startSec: round(startSec),
      durationSec: round(durationSec),
      endSec: round(startSec + durationSec),
      overlayText: module.overlayText || '',
      narration: module.narration || '',
      assetClass: module.assetClass || 'graphic',
      assetNeed: module.assetNeed || null,
      // When true, the subtitle layer is hidden during this module. Used
      // for QuoteCard / NumberCard / ChargeCard where the on-card text
      // already carries the meaning at large type and a subtitle bar would
      // just double-paint.
      subtitleSuppress: Boolean(module.subtitleSuppress),
      data: module.data || {},
      asset: {
        kind: module.assetClass || 'graphic',
        src: null,
        safetyClass: module.assetClass || 'graphic',
      },
    };
    cursor = Math.max(cursor, startSec + durationSec);
    return result;
  });

  // Safety net: ensure video duration covers narration length + tail pad.
  const tailPadSec = 0.4;
  const minimumTotal = narrationDuration + tailPadSec;
  if (cursor < minimumTotal && planned.length > 0) {
    const last = planned[planned.length - 1];
    const additional = round(minimumTotal - cursor);
    last.durationSec = round(last.durationSec + additional);
    last.endSec = round(last.startSec + last.durationSec);
    cursor = minimumTotal;
  }

  return {
    story_id: story.id,
    story_type: evidencePackage.story_type,
    template: `${evidencePackage.story_type}_v1`,
    modules: planned,
    totalDurationSec: round(cursor),
  };
}

// Walks each script segment, finds its char-range in full_script, and looks
// up the corresponding start/end times from voice.alignment. Returns a map
// keyed by segment role.
function buildSegmentTimings(script, voice) {
  const alignment = voice?.alignment;
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const fullScript = script?.full_script;
  if (!starts.length || !ends.length || !fullScript || !Array.isArray(script.segments)) {
    return {};
  }

  const timings = {};
  let cursor = 0;
  for (const segment of script.segments) {
    const text = segment.text || '';
    if (!text) continue;
    const startIdx = fullScript.indexOf(text, cursor);
    if (startIdx < 0) continue;
    const endIdx = startIdx + text.length - 1;
    const startSec = findNearestTime(starts, startIdx, 'forward');
    const endSec = findNearestTime(ends, endIdx, 'backward');
    if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec >= startSec) {
      timings[segment.role] = { startSec, endSec };
    }
    cursor = startIdx + text.length;
  }
  return timings;
}

function findNearestTime(times, index, direction) {
  if (Number.isFinite(times[index])) return times[index];
  const step = direction === 'forward' ? 1 : -1;
  for (let offset = 1; offset < 30; offset++) {
    const value = times[index + offset * step];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

// For each module whose role has an alignment-derived timing, set startSec
// and durationSec on the template module. Outro pins after last voiced end.
//
// Two-step narration aware: when a module's spoken segment is short (e.g.
// the QuoteCard's voiceover is a 3-second bridge but the verbatim on
// screen needs 8 seconds to read), the alignment-derived duration would
// crunch the card. We honour `minDurationSec` post-alignment by extending
// the module and sliding all later modules forward.
function applyVoiceTimings(template, script, voice) {
  const segmentTimings = buildSegmentTimings(script, voice);
  if (!Object.keys(segmentTimings).length) return template;

  const narrated = template
    .filter((m) => m.role !== 'outro' && segmentTimings[m.role])
    .map((m) => ({ role: m.role, ...segmentTimings[m.role] }))
    .sort((a, b) => a.startSec - b.startSec);

  if (!narrated.length) return template;

  const lastVoiceEnd = Math.max(
    voice.totalDurationSec || 0,
    ...narrated.map((m) => m.endSec),
  );
  let outroStart = lastVoiceEnd + 0.45;

  // First pass: apply voice timings + tail.
  let timed = template.map((module) => {
    if (module.role === 'outro') {
      return {
        ...module,
        startSec: outroStart,
        durationSec: Math.max(module.durationHintSec || 3.4, 3.6),
      };
    }
    const timing = segmentTimings[module.role];
    if (!timing) return module;
    const nextNarrated = narrated.find((m) => m.startSec > timing.startSec + 0.001);
    const nextStart = nextNarrated ? nextNarrated.startSec : outroStart;
    const segmentTail = timing.endSec + 0.25;
    return {
      ...module,
      startSec: timing.startSec,
      durationSec: Math.max(1.2, nextStart - timing.startSec, segmentTail - timing.startSec),
    };
  });

  // Second pass: enforce minDurationSec ONLY on the FINAL narrated module
  // (the closer). Extending interior modules and sliding later ones forward
  // is wrong — the TTS audio doesn't shift, so the next segment's
  // narration plays while the previous module is still on screen.
  // Each segment's natural audio window is the source of truth for its
  // module's duration; the AI prompts are responsible for writing
  // narration that fills the desired visual time.
  const orderedNarratedModules = timed
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => segmentTimings[m.role])
    .sort((a, b) => a.m.startSec - b.m.startSec);

  if (orderedNarratedModules.length > 0) {
    const last = orderedNarratedModules[orderedNarratedModules.length - 1].m;
    const minNeeded = last.minDurationSec || 0;
    if (minNeeded > 0 && last.durationSec < minNeeded) {
      // Closer can extend safely — there's no later segment to compete
      // with the audio. Outro pins after this module's new endSec.
      last.durationSec = minNeeded;
      outroStart = last.startSec + last.durationSec + 0.45;
    }
  }

  // Re-pin outro start after any closer extension.
  timed = timed.map((module) =>
    module.role === 'outro'
      ? { ...module, startSec: outroStart }
      : module,
  );

  return timed;
}

function hasExactTiming(module) {
  return Number.isFinite(module.startSec) && Number.isFinite(module.durationSec);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(v) {
  return Number(v.toFixed(3));
}

module.exports = {
  planModules,
};
