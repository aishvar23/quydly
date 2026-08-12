'use strict';

const Anthropic = require('@anthropic-ai/sdk');
// Spend gate — this pipeline bills to its own key, not the production one.
// See scripts/lib/video-anthropic-key.cjs.
const { requireVideoAnthropicKey } = require('../../scripts/lib/video-anthropic-key.cjs');

// NOTE: claude-sonnet-4-20250514 reached end-of-life on 2026-06-15 and now
// returns 404. This client cannot succeed as written; left in place because
// fixing the model choice is a separate decision from the spend gate.
const MODEL = 'claude-sonnet-4-20250514';
let _client = null;

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: requireVideoAnthropicKey('animated-video-pipeline') });
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
