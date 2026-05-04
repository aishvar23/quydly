'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-20250514';
let _client = null;

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

async function complete({ prompt, maxTokens = 2048, systemPrompt }) {
  const client   = getClient();
  const messages = [{ role: 'user', content: prompt }];
  const params   = { model: MODEL, max_tokens: maxTokens, messages };
  if (systemPrompt) params.system = systemPrompt;

  const response = await client.messages.create(params);
  const raw      = response.content[0].text.trim();
  return raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
}

async function completeJSON(opts) {
  const raw = await complete(opts);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`[claude] invalid JSON response: ${raw.slice(0, 300)}`);
  }
}

module.exports = { complete, completeJSON };
