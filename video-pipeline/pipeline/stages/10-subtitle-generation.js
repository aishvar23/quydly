'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_WORDS_PER_CUE = 4;
const MIN_CUE_DUR       = 0.7;

async function run(ctx) {
  const { script, modulePlan, storyId, alignment, totalDuration, outputDir } = ctx;

  const outroModule = modulePlan.find(m => m.moduleType === 'OutroLockup');
  const outroStart  = outroModule?.startSec ?? totalDuration;

  console.log('[10-subtitle-generation] Building subtitle cues...');

  const cues = buildCues(script.full_script, alignment, outroStart);

  const srtPath  = path.join(outputDir, `story-${storyId}-subtitles.srt`);
  const cuePath  = path.join(outputDir, `story-${storyId}-subtitle-cues.json`);
  fs.writeFileSync(srtPath,  formatSRT(cues), 'utf8');
  fs.writeFileSync(cuePath,  JSON.stringify(cues, null, 2), 'utf8');

  console.log(`[10-subtitle-generation] ✓ ${cues.length} cues (suppressed after ${outroStart.toFixed(1)}s)`);
  return { subtitleCues: cues, srtPath, subtitleCuesPath: cuePath };
}

function buildCues(fullScript, alignment, cutoffTime) {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;

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
    words.push({ text: word, start: wordStart, end: character_end_times_seconds[characters.length - 1] ?? cutoffTime });
  }

  const filtered = words.filter(w => w.start < cutoffTime - 0.5);
  const cues     = [];
  let group      = [];

  for (const w of filtered) {
    group.push(w);
    if (group.length >= MAX_WORDS_PER_CUE) {
      flushGroup(group, cues);
      group = [];
    }
  }
  if (group.length > 0) flushGroup(group, cues);

  return cues;
}

function flushGroup(group, cues) {
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

function pad(n, len = 2) { return String(n).padStart(len, '0'); }

module.exports = { run };
