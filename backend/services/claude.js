import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REQUIRED_KEYS = ["question", "options", "correctIndex", "tldr", "categoryId"];

/**
 * Generate one multiple-choice question from a headline.
 * @param {{ title: string, description: string }} headline
 * @param {string} categoryId  — e.g. "world", "tech"
 * @returns {Promise<{ question, options, correctIndex, tldr, categoryId }>}
 */
export async function generateQuestion(headline, categoryId) {
  const prompt = `You are a witty news quiz writer for Quydly, a daily news game.

Generate ONE multiple-choice question about this real news story:
Title: ${headline.title}
Summary: ${headline.description}

Rules:
- Punchy, witty, jargon-free — smart but not academic
- 4 options: exactly 1 correct, 3 plausible distractors
- TL;DR: exactly 2 sentences of story context

Respond ONLY with valid JSON, no markdown:
{
  "question": "string",
  "options": ["A","B","C","D"],
  "correctIndex": 0,
  "tldr": "Two sentence string.",
  "categoryId": "${categoryId}"
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].text.trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Claude returned invalid JSON for category "${categoryId}": ${raw}`);
  }

  for (const key of REQUIRED_KEYS) {
    if (parsed[key] === undefined || parsed[key] === null || parsed[key] === "") {
      throw new Error(`Claude response missing or empty field "${key}" for category "${categoryId}"`);
    }
  }
  if (!Array.isArray(parsed.options) || parsed.options.length !== 4) {
    throw new Error(`Claude response has wrong options array for category "${categoryId}"`);
  }
  if (typeof parsed.correctIndex !== "number" || parsed.correctIndex < 0 || parsed.correctIndex > 3) {
    throw new Error(`Claude response has invalid correctIndex for category "${categoryId}"`);
  }

  return parsed;
}
