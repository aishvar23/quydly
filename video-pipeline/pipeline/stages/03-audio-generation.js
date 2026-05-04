'use strict';

const path = require('path');
const { generateAudio } = require('../../lib/tts-client');

async function run(ctx) {
  const { script, storyId, outputDir } = ctx;
  const audioPath = path.join(outputDir, `story-${storyId}-audio.mp3`);

  console.log('[03-audio-generation] Generating narration...');
  const result = await generateAudio(script.full_script, audioPath);

  if (result.isStub) {
    console.warn('[03-audio-generation] Running with stub audio (no ElevenLabs key)');
  } else {
    console.log(`[03-audio-generation] ✓ Audio: ${result.totalDuration.toFixed(1)}s → ${path.basename(audioPath)}`);
  }

  return {
    audioPath:     result.audioPath,
    alignment:     result.alignment,
    totalDuration: result.totalDuration,
    isAudioStub:   result.isStub,
  };
}

module.exports = { run };
