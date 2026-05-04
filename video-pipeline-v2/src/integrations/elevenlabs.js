'use strict';

const fs = require('fs');
const { fetchWithRetry } = require('./http');

const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah — female news-style, evaluated and approved
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const WORDS_PER_SECOND_FALLBACK = 2.55;

// News-anchor-leaning defaults. Lower stability + higher style gives more
// expressive, less monotone delivery — closer to a real news read than the
// flat default. Override per-run via env if you want a different feel:
//   ELEVENLABS_STABILITY=0.40 ELEVENLABS_STYLE=0.50 ELEVENLABS_SIMILARITY_BOOST=0.80
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.78,
  style: 0.40,
  use_speaker_boost: true,
};

function readVoiceSettings(overrides = {}) {
  return {
    stability: numFromEnv('ELEVENLABS_STABILITY', overrides.stability ?? DEFAULT_VOICE_SETTINGS.stability),
    similarity_boost: numFromEnv('ELEVENLABS_SIMILARITY_BOOST', overrides.similarity_boost ?? DEFAULT_VOICE_SETTINGS.similarity_boost),
    style: numFromEnv('ELEVENLABS_STYLE', overrides.style ?? DEFAULT_VOICE_SETTINGS.style),
    use_speaker_boost: boolFromEnv('ELEVENLABS_USE_SPEAKER_BOOST', overrides.use_speaker_boost ?? DEFAULT_VOICE_SETTINGS.use_speaker_boost),
  };
}

function numFromEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function boolFromEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return /^(true|1|yes)$/i.test(String(raw));
}

function hasElevenLabs() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

async function generateNarration(text, outputPath, options = {}) {
  if (options.forceSynthetic) {
    return timingOnly(text, { forced: true });
  }
  if (!hasElevenLabs()) {
    return timingOnly(text);
  }

  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const model = options.model || process.env.ELEVENLABS_MODEL || DEFAULT_MODEL;
  const voiceSettings = readVoiceSettings(options.voiceSettings || {});
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;

  let response;
  try {
    response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: voiceSettings,
      }),
    });
  } catch (error) {
    console.warn(`[elevenlabs] Network error after retries, falling back to synthetic timing: ${error.message}`);
    return timingOnly(text, { failureReason: 'elevenlabs_network', failureHint: `Network error after retries: ${error.message}` });
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    // ElevenLabs returns structured JSON: { detail: { status, message } }
    // Surface the real reason (quota_exceeded, invalid_api_key, etc.) so
    // the fallback report shows it, instead of an opaque "synthetic_timing".
    const parsed = parseElevenLabsError(errorText);
    console.warn(
      `[elevenlabs] HTTP ${response.status}${parsed.status ? ` (${parsed.status})` : ''}, ` +
      `falling back to synthetic timing. ${parsed.message || errorText.slice(0, 400)}`,
    );
    return timingOnly(text, {
      failureReason: parsed.status ? `elevenlabs_${parsed.status}` : `elevenlabs_http_${response.status}`,
      failureHint: parsed.message || errorText.slice(0, 240),
    });
  }

  const data = await response.json();
  if (!data?.audio_base64) {
    console.warn('[elevenlabs] Response missing audio_base64, falling back to synthetic timing');
    return timingOnly(text, { failureReason: 'elevenlabs_no_audio', failureHint: 'Response missing audio_base64' });
  }

  fs.writeFileSync(outputPath, Buffer.from(data.audio_base64, 'base64'));
  const alignment = data.alignment || timingOnly(text).alignment;
  const totalDurationSec = lastTime(alignment) || estimateDuration(text);

  return {
    audioPath: outputPath,
    alignment,
    totalDurationSec,
    isTimingOnly: false,
  };
}

function timingOnly(text, options = {}) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const characters = [];
  const starts = [];
  const ends = [];
  let cursor = 0;

  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    const wordDuration = Math.max(word.length * 0.045, 0.18);
    for (let i = 0; i < word.length; i++) {
      characters.push(word[i]);
      starts.push(round(cursor + (i / word.length) * wordDuration));
      ends.push(round(cursor + ((i + 1) / word.length) * wordDuration));
    }
    if (w < words.length - 1) {
      characters.push(' ');
      starts.push(round(cursor + wordDuration));
      ends.push(round(cursor + wordDuration + 0.04));
    }
    cursor += wordDuration + 0.13;
  }

  const totalDurationSec = Math.max(round(cursor), estimateDuration(text));

  return {
    audioPath: null,
    alignment: {
      characters,
      character_start_times_seconds: starts,
      character_end_times_seconds: ends,
    },
    totalDurationSec,
    isTimingOnly: true,
    forcedSynthetic: Boolean(options.forced),
    failureReason: options.failureReason || null,
    failureHint: options.failureHint || null,
  };
}

// Parse ElevenLabs' { detail: { status, message } } error envelope.
// Returns { status, message } with safe fallbacks. Status becomes the
// fallback-report `kind` suffix (e.g. quota_exceeded → elevenlabs_quota_exceeded).
function parseElevenLabsError(body) {
  if (!body) return { status: null, message: null };
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.detail;
    if (typeof detail === 'string') return { status: null, message: detail };
    if (detail && typeof detail === 'object') {
      return {
        status: typeof detail.status === 'string' ? detail.status : null,
        message: typeof detail.message === 'string' ? detail.message : null,
      };
    }
  } catch (_) { /* fall through */ }
  return { status: null, message: body.slice(0, 240) };
}

function estimateDuration(text) {
  const wordCount = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(wordCount / WORDS_PER_SECOND_FALLBACK, 12);
}

function lastTime(alignment) {
  const times = alignment?.character_end_times_seconds || [];
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
