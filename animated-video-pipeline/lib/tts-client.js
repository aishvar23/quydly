'use strict';

const axios = require('axios');
const fs    = require('fs');

const VOICE_ID      = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const MODEL_ID      = 'eleven_multilingual_v2';
const WORDS_PER_SEC = 2.5;

async function generateAudio(text, outputPath) {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.warn('[tts] ELEVENLABS_API_KEY not set — generating stub audio');
    return generateStub(text, outputPath);
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`;

  let response;
  try {
    response = await axios.post(
      url,
      {
        text,
        model_id:       MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );
  } catch (err) {
    console.warn(`[tts] ElevenLabs request failed (${err.message}) — falling back to stub`);
    return generateStub(text, outputPath);
  }

  const { audio_base64, alignment } = response.data;
  fs.writeFileSync(outputPath, Buffer.from(audio_base64, 'base64'));

  const chars        = alignment.character_end_times_seconds;
  const totalDuration = chars[chars.length - 1] || estimateDuration(text);

  return { audioPath: outputPath, alignment, totalDuration, isStub: false };
}

function generateStub(text, outputPath) {
  const words = text.trim().split(/\s+/);
  const totalDuration = words.length / WORDS_PER_SEC;

  const chars  = [];
  const starts = [];
  const ends   = [];
  let t = 0;

  for (const word of words) {
    const wordDur = word.length * 0.04 + 0.05;
    for (let i = 0; i < word.length; i++) {
      chars.push(word[i]);
      starts.push(parseFloat((t + (i / word.length) * wordDur).toFixed(3)));
      ends.push(parseFloat((t + ((i + 1) / word.length) * wordDur).toFixed(3)));
    }
    chars.push(' ');
    starts.push(parseFloat((t + wordDur).toFixed(3)));
    ends.push(parseFloat((t + wordDur + 0.05).toFixed(3)));
    t += wordDur + 0.1;
  }

  const alignment = {
    characters:                     chars,
    character_start_times_seconds:  starts,
    character_end_times_seconds:    ends,
  };

  fs.writeFileSync(outputPath, Buffer.alloc(0));
  return { audioPath: outputPath, alignment, totalDuration, isStub: true };
}

function estimateDuration(text) {
  return text.trim().split(/\s+/).length / WORDS_PER_SEC;
}

module.exports = { generateAudio };
