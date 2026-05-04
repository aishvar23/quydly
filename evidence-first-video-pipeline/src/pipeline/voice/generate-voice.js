'use strict';

const path = require('path');
const { generateNarration } = require('../../integrations/elevenlabs');

async function generateVoice(script, outputDir) {
  const audioPath = path.join(outputDir, 'narration.mp3');
  return generateNarration(script.full_script, audioPath);
}

module.exports = {
  generateVoice,
};
