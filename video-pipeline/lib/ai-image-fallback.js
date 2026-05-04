'use strict';

const axios  = require('axios');
const fs     = require('fs');

// DALL-E 3 fallback: conceptual/non-literal visuals only.
// Hard rules enforced here, not left to the caller:
//   - Never depict named real individuals
//   - Never depict specific named events
//   - Only fire if the concept explicitly allows it (dalle_allowed: true in visual-concept-map)

const BLOCKED_TERMS = [
  'van dyke', 'gannon', 'maduro', 'nicolas', 'polymarket',
  'venezuela operation', 'specific person', 'real person',
];

async function generateFallbackImage(concept, outputPath) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[dalle] OPENAI_API_KEY not set — skipping DALL-E fallback');
    return null;
  }

  const prompt = buildSafePrompt(concept);
  if (!prompt) {
    console.warn(`[dalle] Concept "${concept.key}" not eligible for DALL-E`);
    return null;
  }

  if (!concept.dalle_allowed) {
    console.warn(`[dalle] Concept "${concept.key}" has dalle_allowed=false`);
    return null;
  }

  try {
    const { OpenAI } = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.images.generate({
      model:   'dall-e-3',
      prompt,
      n:       1,
      size:    '1024x1792',  // closest to 9:16
      quality: 'standard',
      style:   'natural',
    });

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) return null;

    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(outputPath, imgResponse.data);
    console.log(`[dalle] Generated fallback image → ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.warn(`[dalle] Generation failed: ${err.message}`);
    return null;
  }
}

function buildSafePrompt(concept) {
  if (!concept.dalle_prompt) return null;

  // Verify no blocked terms leaked into the prompt template
  const lower = concept.dalle_prompt.toLowerCase();
  if (BLOCKED_TERMS.some(t => lower.includes(t))) {
    console.error(`[dalle] Blocked term in prompt template for concept "${concept.key}"`);
    return null;
  }

  return concept.dalle_prompt;
}

module.exports = { generateFallbackImage };
