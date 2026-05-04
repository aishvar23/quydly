'use strict';

const path = require('path');
const { generateNarration } = require('../../integrations/elevenlabs');

// Returns { audioPath, alignment, totalDurationSec, isTimingOnly, forcedSynthetic }.
// Real TTS when ELEVENLABS_API_KEY is set; synthetic timing otherwise.
// options.forceSynthetic skips the API call entirely (used by --dry-run-fallbacks).
async function generateVoice(script, outputDir, options = {}) {
  const fullScript = String(script.full_script || '').trim();
  if (!fullScript) {
    throw new Error('Cannot generate voice timing for empty script');
  }
  const audioPath = outputDir ? path.join(outputDir, 'narration.mp3') : null;
  return generateNarration(fullScript, audioPath, {
    forceSynthetic: Boolean(options.forceSynthetic),
    voiceId: options.voiceId,
    voiceSettings: options.voiceSettings,
  });
}

module.exports = {
  generateVoice,
};
