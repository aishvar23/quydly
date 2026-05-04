'use strict';

const AnthropicModule = require('@anthropic-ai/sdk');

const Anthropic = AnthropicModule.default || AnthropicModule;

let client = null;

function hasAnthropic() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!hasAnthropic()) {
    throw new Error('ANTHROPIC_API_KEY is required for AI generation');
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function completeJSON({ system, prompt, maxTokens = 1800 }) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  const response = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Anthropic returned invalid JSON: ${text.slice(0, 400)}`);
  }
}

module.exports = {
  hasAnthropic,
  completeJSON,
};
