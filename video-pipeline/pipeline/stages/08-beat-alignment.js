'use strict';

const OUTRO_TYPE       = 'OutroLockup';
const SCENE_END_BUFFER = 0.25;
const OUTRO_DUR        = 4;

async function run(ctx) {
  const { modulePlan, script, alignment, totalDuration } = ctx;

  console.log('[08-beat-alignment] Aligning module durations to narration beats...');

  const aligned = alignModules(modulePlan, script.full_script, alignment, totalDuration);

  aligned.forEach(m => {
    const dur = m.durationSec.toFixed(2);
    console.log(`  Module ${m.moduleId} (${m.moduleType}): ${m.startSec.toFixed(2)}s–${m.endSec.toFixed(2)}s (${dur}s)`);
  });

  console.log(`[08-beat-alignment] ✓ Total duration: ${totalDuration.toFixed(1)}s`);
  return { modulePlan: aligned };
}

function alignModules(modules, fullText, alignment, totalDuration) {
  if (!alignment?.characters) {
    return proportionalFallback(modules, totalDuration);
  }

  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
  let searchStart = 0;
  const segmentTimes = [];

  for (const module of modules) {
    const seg = module.narrationSegment?.trim() || '';

    if (module.moduleType === OUTRO_TYPE || seg.length === 0) {
      segmentTimes.push(null);
      continue;
    }

    const idx = findSegment(fullText, seg, searchStart);
    if (idx === -1) {
      console.warn(`[beat-align] Could not locate segment for module ${module.moduleId} (${module.moduleType})`);
      segmentTimes.push(null);
      continue;
    }

    const charStart = mapCharIndex(idx, characters, character_start_times_seconds);
    const charEnd   = mapCharIndex(idx + seg.length - 1, characters, character_end_times_seconds);
    segmentTimes.push({ start: charStart, end: charEnd });
    searchStart = idx + seg.length;
  }

  const matched = segmentTimes.filter(Boolean).length;
  if (matched < Math.floor(modules.length * 0.5)) {
    console.warn('[beat-align] Too many mismatches — proportional distribution');
    return proportionalFallback(modules, totalDuration);
  }

  // Fill null gaps
  for (let i = 0; i < modules.length; i++) {
    if (segmentTimes[i] !== null || modules[i].moduleType === OUTRO_TYPE) continue;
    const prev = findPrevTime(segmentTimes, i);
    const next = findNextTime(segmentTimes, i, totalDuration);
    const gap  = (next - prev) / countNulls(segmentTimes, i);
    segmentTimes[i] = { start: prev, end: prev + gap };
  }

  // Outro: append after last narration segment
  const outroIdx = modules.findIndex(m => m.moduleType === OUTRO_TYPE);
  if (outroIdx !== -1) {
    const prevEnd = outroIdx > 0
      ? (segmentTimes[outroIdx - 1]?.end ?? totalDuration - OUTRO_DUR)
      : totalDuration - OUTRO_DUR;
    segmentTimes[outroIdx] = { start: prevEnd, end: prevEnd + OUTRO_DUR };
  }

  return modules.map((module, i) => {
    const times = segmentTimes[i];
    if (!times) return module;
    const startSec = parseFloat(times.start.toFixed(3));
    const endSec   = parseFloat(Math.min(times.end + SCENE_END_BUFFER, totalDuration + OUTRO_DUR).toFixed(3));
    return {
      ...module,
      startSec,
      endSec,
      durationSec: parseFloat(Math.max(endSec - startSec, 2.0).toFixed(3)),
    };
  });
}

function mapCharIndex(scriptPos, characters, times) {
  const ratio    = scriptPos / Math.max(characters.length - 1, 1);
  const alignIdx = Math.min(Math.round(ratio * (characters.length - 1)), times.length - 1);
  return times[alignIdx] ?? 0;
}

function findSegment(fullText, segment, fromIdx) {
  const idx = fullText.indexOf(segment, fromIdx);
  if (idx !== -1) return idx;
  return fullText.indexOf(segment.slice(0, 30), fromIdx);
}

function findPrevTime(times, fromIdx) {
  for (let i = fromIdx - 1; i >= 0; i--) {
    if (times[i]) return times[i].end;
  }
  return 0;
}

function findNextTime(times, fromIdx, totalDuration) {
  for (let i = fromIdx + 1; i < times.length; i++) {
    if (times[i]) return times[i].start;
  }
  return totalDuration;
}

function countNulls(times, aroundIdx) {
  let count = 1;
  for (let i = aroundIdx + 1; i < times.length && !times[i]; i++) count++;
  return count;
}

function proportionalFallback(modules, totalDuration) {
  const narModules = modules.filter(m => m.moduleType !== OUTRO_TYPE);
  const words      = narModules.map(m => (m.narrationSegment || '').trim().split(/\s+/).filter(Boolean).length);
  const totalWords = words.reduce((a, b) => a + b, 0) || 1;
  const narDur     = totalDuration - OUTRO_DUR;

  let cursor = 0;
  let narIdx = 0;
  return modules.map(module => {
    if (module.moduleType === OUTRO_TYPE) {
      return {
        ...module,
        startSec:   parseFloat(cursor.toFixed(3)),
        endSec:     parseFloat((cursor + OUTRO_DUR).toFixed(3)),
        durationSec: OUTRO_DUR,
      };
    }
    const dur = parseFloat(((words[narIdx] / totalWords) * narDur).toFixed(3));
    const s   = parseFloat(cursor.toFixed(3));
    const e   = parseFloat((cursor + dur).toFixed(3));
    cursor += dur;
    narIdx++;
    return { ...module, startSec: s, endSec: e, durationSec: Math.max(dur, 2.0) };
  });
}

module.exports = { run };
