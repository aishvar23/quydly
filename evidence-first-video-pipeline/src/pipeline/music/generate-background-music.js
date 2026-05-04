'use strict';

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BPM = 96;

function generateBackgroundMusic(storyPackage, outputDir) {
  const durationSec = Math.max(storyPackage.totalDurationSec || storyPackage.voice?.totalDurationSec || 42, 12);
  const audioPath = path.join(outputDir, 'background-music.wav');

  writeWav(audioPath, renderUrgentEditorialBed(durationSec + 0.25));

  return {
    ...storyPackage,
    music: {
      audioPath,
      style: 'urgent_editorial_tension_bed',
      license: 'procedural_generated',
      durationSec: round(durationSec),
      mixVolume: 0.55,
      notes: [
        'Faster editorial pulse, clearer midrange accents, and restrained low tension for legal/scandal explainers.',
        'Generated locally by the pipeline; no stock track or external license.',
        'Mixed under narration with fade-in and fade-out in Remotion.',
      ],
    },
  };
}

function renderUrgentEditorialBed(durationSec) {
  const frameCount = Math.ceil(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(frameCount * CHANNELS);
  let seed = 513155;

  for (let index = 0; index < frameCount; index++) {
    const time = index / SAMPLE_RATE;
    const fade = envelope(time, durationSec);
    const beatPhase = (time % beatLength()) / beatLength();
    const halfBeatPhase = (time % (beatLength() / 2)) / (beatLength() / 2);
    const quarterBeatPhase = (time % (beatLength() / 4)) / (beatLength() / 4);
    const barPhase = (time % (beatLength() * 4)) / (beatLength() * 4);
    const movement = 0.82 + 0.18 * sine(0.07, time);

    const drone = (
      0.16 * sine(49, time) +
      0.11 * sine(73.42, time) +
      0.08 * sine(98, time)
    ) * movement;

    const pad = (
      0.08 * sine(196, time + 0.04) +
      0.06 * sine(293.66, time) +
      0.035 * sine(392, time + 0.02)
    ) * (0.55 + 0.45 * sine(0.046, time));

    const pulse = lowPulse(beatPhase, time);
    const midPulse = editorialPulse(beatPhase, time) + offbeatPulse(halfBeatPhase, time);
    const tickNoise = tick(quarterBeatPhase, time, nextRandom());
    const tension = 0.04 * sine(36.71, time) * (0.45 + 0.55 * sine(0.028, time));
    const arc = 0.035 * sine(587.33, time) * Math.sin(Math.PI * barPhase) * (0.35 + 0.65 * fade);

    const mono = softLimit((drone + pad + pulse + midPulse + tickNoise + tension + arc) * fade * 0.82);
    const pan = 0.08 * sine(0.055, time);
    samples[index * 2] = mono * (1 - pan);
    samples[index * 2 + 1] = mono * (1 + pan);
  }

  return samples;

  function nextRandom() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  }
}

function beatLength() {
  return 60 / BPM;
}

function lowPulse(phase, time) {
  if (phase > 0.2) return 0;
  const decay = Math.exp(-phase * 20);
  const sweep = 48 + 32 * (1 - phase / 0.2);
  return 0.2 * decay * sine(sweep, time);
}

function editorialPulse(phase, time) {
  if (phase > 0.24) return 0;
  const decay = Math.exp(-phase * 13);
  return decay * (0.09 * sine(293.66, time) + 0.055 * sine(587.33, time));
}

function offbeatPulse(phase, time) {
  if (phase < 0.46 || phase > 0.74) return 0;
  const localPhase = (phase - 0.46) / 0.28;
  const decay = Math.exp(-localPhase * 10);
  return decay * (0.05 * sine(392, time) + 0.03 * sine(784, time));
}

function tick(phase, time, random) {
  if (phase > 0.052) return 0;
  const noise = (random * 2 - 1) * 0.06;
  const click = 0.045 * sine(1046.5, time) + 0.026 * sine(1568, time);
  return (noise + click) * Math.exp(-phase * 78);
}

function envelope(time, durationSec) {
  const fadeIn = clamp(time / 3.2, 0, 1);
  const fadeOut = clamp((durationSec - time) / 4.5, 0, 1);
  return fadeIn * fadeOut;
}

function sine(frequency, time) {
  return Math.sin(Math.PI * 2 * frequency * time);
}

function softLimit(value) {
  return Math.tanh(value * 1.35);
}

function writeWav(filePath, samples) {
  const dataSize = samples.length * BYTES_PER_SAMPLE;
  const buffer = Buffer.alloc(44 + dataSize);
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;
  const byteRate = SAMPLE_RATE * blockAlign;

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index++) {
    const clamped = clamp(samples[index], -1, 1);
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * BYTES_PER_SAMPLE);
  }

  fs.writeFileSync(filePath, buffer);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(value.toFixed(3));
}

module.exports = {
  generateBackgroundMusic,
};
