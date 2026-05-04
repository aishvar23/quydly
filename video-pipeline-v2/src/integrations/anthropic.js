'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// Sonnet 4.6 — capable + fast for structured editorial generation.
const DEFAULT_MODEL = 'claude-sonnet-4-5';
let cachedClient = null;

function hasAnthropic() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!cachedClient) {
    const Ctor = Anthropic.default || Anthropic;
    cachedClient = new Ctor({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

// JSON-mode helper. System prompt is marked cacheable — when it crosses the
// 1024-token threshold (or grows in future slices), Anthropic will cache it.
async function completeJSON({ system, prompt, maxTokens = 1800 }) {
  if (!hasAnthropic()) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  const block = (response.content || []).find((c) => c.type === 'text');
  const text = block?.text || '';
  return parseJsonFromResponse(text);
}

function parseJsonFromResponse(text) {
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error(`Failed to parse JSON from Claude response: ${text.slice(0, 400)}`);
  }
}

module.exports = {
  hasAnthropic,
  completeJSON,
};
