'use strict';

const fs = require('fs');
const path = require('path');

const MAX_WORDS_PER_CUE = 6;
const MIN_WORDS_BEFORE_SOFT_BREAK = 4;

function generateSubtitles(storyPackage, outputDir) {
  const cues = buildSubtitleCues(storyPackage.script.full_script, storyPackage.voice.alignment);
  const srt = formatSrt(cues);
  const srtPath = path.join(outputDir, 'subtitles.srt');
  const cuesPath = path.join(outputDir, 'subtitle-cues.json');

  fs.writeFileSync(srtPath, srt, 'utf8');
  fs.writeFileSync(cuesPath, JSON.stringify(cues, null, 2), 'utf8');

  return {
    ...storyPackage,
    subtitles: cues,
    srtPath,
    subtitleCuesPath: cuesPath,
  };
}

function buildSubtitleCues(fullScript, alignment) {
  const words = wordsFromAlignment(fullScript, alignment);
  const cues = [];
  let group = [];
  for (const word of words) {
    group.push(word);
    if (shouldFlush(group)) {
      cues.push(flush(group));
      group = [];
    }
  }
  if (group.length) cues.push(flush(group));
  return cues;
}

function shouldFlush(group) {
  const last = group[group.length - 1]?.text || '';
  if (group.length >= MAX_WORDS_PER_CUE) return true;
  if (/[.!?]$/.test(last) && group.length >= 2) return true;
  if (/[,;:]$/.test(last) && group.length >= MIN_WORDS_BEFORE_SOFT_BREAK) return true;
  return false;
}

function wordsFromAlignment(fullScript, alignment) {
  const chars = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const words = [];
  let current = '';
  let start = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (current) {
        words.push({ text: current, start, end: ends[i - 1] || start + 0.7 });
        current = '';
        start = null;
      }
    } else {
      if (start === null) start = starts[i] || 0;
      current += ch;
    }
  }
  if (current) {
    words.push({ text: current, start, end: ends[ends.length - 1] || start + 0.7 });
  }

  if (words.length) return words;
  return fallbackWords(fullScript);
}

function fallbackWords(fullScript) {
  let cursor = 0;
  return String(fullScript).split(/\s+/).filter(Boolean).map((word) => {
    const start = cursor;
    const end = start + 0.36;
    cursor = end + 0.08;
    return { text: word, start, end };
  });
}

function flush(group) {
  const start = group[0].start;
  const end = Math.max(group[group.length - 1].end, start + 0.8);
  return {
    start: round(start),
    end: round(end),
    text: group.map((w) => w.text).join(' '),
  };
}

function formatSrt(cues) {
  return cues.map((cue, idx) => [
    String(idx + 1),
    `${formatTime(cue.start)} --> ${formatTime(cue.end)}`,
    cue.text,
    '',
  ].join('\n')).join('\n');
}

function formatTime(value) {
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  const ms = Math.round((value % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(v, n = 2) { return String(v).padStart(n, '0'); }
function round(v) { return Number(v.toFixed(3)); }

module.exports = {
  generateSubtitles,
  buildSubtitleCues,
  formatSrt,
};
