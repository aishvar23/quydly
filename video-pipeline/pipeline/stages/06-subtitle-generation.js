'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_WORDS_PER_LINE = 4;   // V3: short cues, subtitle is support not caption
const MAX_LINES          = 2;
const MIN_CUE_DUR        = 0.7;

async function run(ctx) {
  const { script, storyId, alignment, totalDuration, outputDir } = ctx;
  const subtitlePath = path.join(outputDir, `story-${storyId}-subtitles.srt`);

  // Find outro start — subtitles are suppressed from this point on
  const outroScene   = script.scenes.find(s => s.safe_visual_concept === 'brand_outro');
  const outroStart   = outroScene?.start_time_sec ?? totalDuration;

  console.log('[06-subtitle-generation] Building subtitle cues...');

  const cues = buildCues(script.full_script, alignment, outroStart);
  const srt  = formatSRT(cues);

  fs.writeFileSync(subtitlePath, srt, 'utf8');
  console.log(`[06-subtitle-generation] ✓ ${cues.length} cues (suppressed after ${outroStart.toFixed(1)}s) → ${path.basename(subtitlePath)}`);

  return { subtitlePath };
}

function buildCues(fullScript, alignment, cutoffTime) {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;

  // Reconstruct word-level timing
  const words = [];
  let word = '';
  let wordStart = null;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === ' ' || ch === '\n') {
      if (word && wordStart !== null) {
        words.push({ text: word, start: wordStart, end: character_end_times_seconds[i - 1] ?? 0 });
        word = '';
        wordStart = null;
      }
    } else {
      if (wordStart === null) wordStart = character_start_times_seconds[i];
      word += ch;
    }
  }
  if (word && wordStart !== null) {
    const lastEnd = character_end_times_seconds[characters.length - 1] ?? cutoffTime;
    words.push({ text: word, start: wordStart, end: lastEnd });
  }

  // Filter out words that start after the outro (no subs over brand outro)
  const filteredWords = words.filter(w => w.start < cutoffTime - 0.5);

  // Group into cues: max MAX_WORDS_PER_LINE per line, max MAX_LINES lines
  const cues  = [];
  let group   = [];
  let lineLen = 0;
  let lines   = 1;

  for (const w of filteredWords) {
    const addLen = (group.length > 0 ? 1 : 0) + w.text.length;
    const wouldExceedLine = lineLen + (group.length > 0 ? 1 : 0) >= MAX_WORDS_PER_LINE;

    if (wouldExceedLine) {
      if (lines < MAX_LINES) {
        lines++;
        lineLen = 0;
      } else {
        if (group.length > 0) flush(group, cues);
        group = [];
        lineLen = 0;
        lines = 1;
      }
    }

    group.push(w);
    lineLen++;
  }
  if (group.length > 0) flush(group, cues);

  return cues;
}

function flush(group, cues) {
  const start = group[0].start;
  const end   = Math.max(group[group.length - 1].end, start + MIN_CUE_DUR);
  cues.push({ start, end, text: group.map(w => w.text).join(' ') });
}

function formatSRT(cues) {
  return cues.map((cue, i) =>
    `${i + 1}\n${toSRTTime(cue.start)} --> ${toSRTTime(cue.end)}\n${cue.text}\n`
  ).join('\n');
}

function toSRTTime(sec) {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

module.exports = { run };
