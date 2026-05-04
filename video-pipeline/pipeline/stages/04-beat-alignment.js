'use strict';

// Stage 04: Align scene durations to actual narration timing.
// Uses ElevenLabs character-level alignment to find where each
// narration_segment starts and ends in the audio, then derives
// precise scene durations from real timestamps.
//
// Falls back to proportional distribution if character matching fails.

const SCENE_END_BUFFER = 0.25; // seconds of padding after each narration segment

async function run(ctx) {
  const { script, alignment, totalDuration } = ctx;
  const scenes    = script.scenes;
  const fullText  = script.full_script;

  console.log('[04-beat-alignment] Aligning scene timing to narration beats...');

  const aligned = alignScenes(scenes, fullText, alignment, totalDuration);

  // Log the resulting timing
  aligned.forEach(s => {
    console.log(`  Scene ${s.scene_id} (${s.type}): ${s.start_time_sec.toFixed(2)}s – ${s.end_time_sec.toFixed(2)}s (${s.duration_sec.toFixed(2)}s)`);
  });

  // Mutate scenes in-place on the script object
  script.scenes = aligned;

  console.log(`[04-beat-alignment] ✓ Total video duration: ${totalDuration.toFixed(1)}s`);
  return { totalDuration };
}

function alignScenes(scenes, fullText, alignment, totalDuration) {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;

  // Build a normalised map: char index in full_script → audio timestamp
  // ElevenLabs may collapse whitespace runs — we match greedily.
  let searchStart = 0;
  const segmentTimes = [];

  for (const scene of scenes) {
    const seg = scene.narration_segment?.trim() || '';

    // Skip the brand outro — it has no spoken narration
    if (scene.safe_visual_concept === 'brand_outro' || seg.length === 0) {
      segmentTimes.push(null);
      continue;
    }

    const idx = findSegment(fullText, seg, searchStart);
    if (idx === -1) {
      console.warn(`[beat-align] Could not locate segment for scene ${scene.scene_id} — using proportional fallback`);
      segmentTimes.push(null);
      continue;
    }

    const charStart = mapCharIndex(idx, characters, character_start_times_seconds);
    const charEnd   = mapCharIndex(idx + seg.length - 1, characters, character_end_times_seconds);
    segmentTimes.push({ start: charStart, end: charEnd });
    searchStart = idx + seg.length;
  }

  // If too many failed, fall back entirely to proportional split
  const matched = segmentTimes.filter(Boolean).length;
  if (matched < Math.floor(scenes.length * 0.5)) {
    console.warn('[beat-align] Too many mismatches — using proportional distribution');
    return proportionalFallback(scenes, totalDuration);
  }

  // Fill gaps with proportional durations for unmatched non-outro scenes
  const total = scenes.length;
  for (let i = 0; i < total; i++) {
    if (segmentTimes[i] === null) {
      const prev = findPrevTime(segmentTimes, i);
      const next = findNextTime(segmentTimes, i, totalDuration);
      const gap  = (next - prev) / countNulls(segmentTimes, i);
      segmentTimes[i] = { start: prev, end: prev + gap };
    }
  }

  // Brand outro: append after last narration ends
  const lastEnd = segmentTimes[total - 2]?.end ?? totalDuration - 4;
  segmentTimes[total - 1] = { start: lastEnd, end: lastEnd + 4 };

  return scenes.map((scene, i) => {
    const times    = segmentTimes[i];
    const startSec = parseFloat((times.start).toFixed(3));
    const endSec   = parseFloat((Math.min(times.end + SCENE_END_BUFFER, totalDuration + 4)).toFixed(3));
    return {
      ...scene,
      start_time_sec: startSec,
      end_time_sec:   endSec,
      duration_sec:   parseFloat(Math.max(endSec - startSec, 2.0).toFixed(3)),
    };
  });
}

// Find the character-level index in the alignment array for a given
// position in the full_script string.
function mapCharIndex(scriptPos, characters, times) {
  // The alignment characters array may differ slightly from the raw text
  // due to TTS preprocessing. We use position as a heuristic.
  const ratio = scriptPos / Math.max(characters.length - 1, 1);
  const alignIdx = Math.min(Math.round(ratio * (characters.length - 1)), times.length - 1);
  return times[alignIdx] ?? 0;
}

function findSegment(fullText, segment, fromIdx) {
  const idx = fullText.indexOf(segment, fromIdx);
  if (idx !== -1) return idx;
  // Fuzzy: try first 30 chars of segment
  const prefix = segment.slice(0, 30);
  return fullText.indexOf(prefix, fromIdx);
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

function proportionalFallback(scenes, totalDuration) {
  const outroDur   = 4;
  const narration  = scenes.slice(0, -1);
  const words      = narration.map(s => (s.narration_segment || '').trim().split(/\s+/).length);
  const totalWords = words.reduce((a, b) => a + b, 0) || 1;
  const narDur     = totalDuration - outroDur;

  let cursor = 0;
  const result = narration.map((scene, i) => {
    const dur  = parseFloat(((words[i] / totalWords) * narDur).toFixed(3));
    const s    = parseFloat(cursor.toFixed(3));
    const e    = parseFloat((cursor + dur).toFixed(3));
    cursor += dur;
    return { ...scene, start_time_sec: s, end_time_sec: e, duration_sec: Math.max(dur, 2.0) };
  });

  const outro = scenes[scenes.length - 1];
  result.push({
    ...outro,
    start_time_sec: parseFloat(cursor.toFixed(3)),
    end_time_sec:   parseFloat((cursor + outroDur).toFixed(3)),
    duration_sec:   outroDur,
  });

  return result;
}

module.exports = { run };
