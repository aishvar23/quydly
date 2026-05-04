'use strict';

const fs = require('fs');
const path = require('path');

const MAX_WORDS_PER_CUE = 7;
const MIN_WORDS_BEFORE_SOFT_BREAK = 3;

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
    if (shouldFlushCue(group)) {
      cues.push(flush(group));
      group = [];
    }
  }
  if (group.length) cues.push(flush(group));

  return cues;
}

function shouldFlushCue(group) {
  const lastWord = group[group.length - 1]?.text || '';
  if (group.length >= MAX_WORDS_PER_CUE) return true;
  if (isSentenceEnd(lastWord)) return true;
  if (/[,;:]$/.test(lastWord) && group.length >= MIN_WORDS_BEFORE_SOFT_BREAK) return true;
  return false;
}

function isSentenceEnd(word) {
  const clean = String(word).replace(/[)"']+$/g, '');
  if (!/[.!?]$/.test(clean)) return false;
  return !isAbbreviation(clean);
}

function isAbbreviation(word) {
  return /^(U\.S\.|U\.K\.|Mr\.|Mrs\.|Ms\.|Dr\.|Sen\.|Rep\.|Jan\.|Feb\.|Mar\.|Apr\.|Jun\.|Jul\.|Aug\.|Sep\.|Sept\.|Oct\.|Nov\.|Dec\.)$/i.test(word);
}

function wordsFromAlignment(fullScript, alignment) {
  const chars = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const words = [];
  let current = '';
  let start = null;

  for (let index = 0; index < chars.length; index++) {
    const ch = chars[index];
    if (/\s/.test(ch)) {
      if (current) {
        words.push({ text: current, start, end: ends[index - 1] || start + 0.7 });
        current = '';
        start = null;
      }
    } else {
      if (start === null) start = starts[index] || 0;
      current += ch;
    }
  }

  if (current) words.push({ text: current, start, end: ends[ends.length - 1] || start + 0.7 });

  if (words.length) return words;
  return fallbackWords(fullScript);
}

function fallbackWords(fullScript) {
  let cursor = 0;
  return fullScript.split(/\s+/).filter(Boolean).map((word) => {
    const start = cursor;
    const end = start + 0.36;
    cursor = end + 0.08;
    return { text: word, start, end };
  });
}

function flush(group) {
  const start = group[0].start;
  const end = Math.max(group[group.length - 1].end, start + 0.35);
  return {
    start: round(start),
    end: round(end),
    text: group.map((word) => word.text).join(' '),
  };
}

function formatSrt(cues) {
  return cues.map((cue, index) => [
    String(index + 1),
    `${formatTime(cue.start)} --> ${formatTime(cue.end)}`,
    cue.text,
    '',
  ].join('\n')).join('\n');
}

function formatTime(value) {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  const millis = Math.round((value % 1) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

function round(value) {
  return Number(value.toFixed(3));
}

module.exports = {
  generateSubtitles,
  buildSubtitleCues,
  formatSrt,
};
