'use strict';

const path = require('path');
const { generateAudio } = require('../../lib/tts-client');

async function run(ctx) {
  const { script, storyId, outputDir } = ctx;
  const audioPath = path.join(outputDir, `story-${storyId}-narration.mp3`);

  console.log('[06-generate-voice] Generating narration audio...');
  console.log(`  Script: ${script.full_script.length} chars, ~${script.full_script.trim().split(/\s+/).length} words`);

  const { audioPath: outPath, alignment, totalDuration, isStub } = await generateAudio(
    script.full_script,
    audioPath
  );

  if (isStub) {
    console.warn('[06-generate-voice] Running with stub audio — real output requires ELEVENLABS_API_KEY');
  }

  console.log(`[06-generate-voice] ✓ Audio ${isStub ? '(stub)' : ''} → ${path.basename(outPath)} (${totalDuration.toFixed(1)}s)`);
  return { audioPath: outPath, alignment, totalDuration, isAudioStub: isStub };
}

module.exports = { run };
