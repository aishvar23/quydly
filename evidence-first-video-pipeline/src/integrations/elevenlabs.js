'use strict';

const fs = require('fs');
const axios = require('axios');

const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const WORDS_PER_SECOND = 2.55;

function hasElevenLabs() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

async function generateNarration(text, outputPath) {
  if (!hasElevenLabs()) {
    return timingOnly(text);
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const response = await axios.post(
    url,
    {
      text,
      model_id: DEFAULT_MODEL_ID,
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.75,
        style: 0.15,
      },
    },
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  fs.writeFileSync(outputPath, Buffer.from(response.data.audio_base64, 'base64'));
  const alignment = response.data.alignment || timingOnly(text).alignment;
  const totalDurationSec = lastTime(alignment) || estimateDuration(text);

  return {
    audioPath: outputPath,
    alignment,
    totalDurationSec,
    isTimingOnly: false,
  };
}

function timingOnly(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const totalDurationSec = estimateDuration(text);
  const characters = [];
  const starts = [];
  const ends = [];
  let cursor = 0;

  for (const word of words) {
    const wordDuration = Math.max(word.length * 0.045, 0.18);
    for (let index = 0; index < word.length; index++) {
      characters.push(word[index]);
      starts.push(round(cursor + (index / word.length) * wordDuration));
      ends.push(round(cursor + ((index + 1) / word.length) * wordDuration));
    }
    characters.push(' ');
    starts.push(round(cursor + wordDuration));
    ends.push(round(cursor + wordDuration + 0.04));
    cursor += wordDuration + 0.13;
  }

  return {
    audioPath: null,
    alignment: {
      characters,
      character_start_times_seconds: starts,
      character_end_times_seconds: ends,
    },
    totalDurationSec,
    isTimingOnly: true,
  };
}

function estimateDuration(text) {
  return Math.max(String(text).trim().split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND, 12);
}

function lastTime(alignment) {
  const times = alignment.character_end_times_seconds || [];
  return times[times.length - 1] || 0;
}

function round(value) {
  return Number(value.toFixed(3));
}

module.exports = {
  hasElevenLabs,
  generateNarration,
  timingOnly,
};
