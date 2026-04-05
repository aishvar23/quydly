import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REQUIRED_KEYS = ["question", "options", "correctIndex", "tldr", "categoryId"];

/**
 * Generate one multiple-choice question from a headline.
 * @param {{ title: string, description: string }} headline
 * @param {string} categoryId     — e.g. "world", "tech"
 * @param {string} categoryLabel  — e.g. "World News", "Technology"
 * @returns {Promise<{ question, options, correctIndex, tldr, categoryId }>}
 */
export async function generateQuestion(headline, categoryId, categoryLabel) {
  const prompt = `# Role
You are a witty, elite news analyst for Quydly. Your audience is composed of "smart-curious" adults who hate superficial trivia.

# Task
Transform the provided news story into ONE high-depth, meaningful Multiple Choice Question (MCQ).

# Input Data
- Category: ${categoryLabel}
- Headline: ${headline.title}
- Context: ${headline.description}

# Quality Standards (The "Quydly" Framework)
1. **The "Non-Obvious" Rule:** The answer should NOT be found simply by glancing at the headline. The question must require the user to synthesize the "Context" provided.
2. **Focus on "Second-Order Effects":** Instead of asking "What happened?", ask "What does this event signal for the industry/region?" or "What was the underlying cause?"
3. **Plausible Distractors:** Distractors must be sophisticated. Use "half-truths" or related current events that a casual reader might confuse with this story. Avoid "joke" or obviously wrong answers.
4. **Tone:** Use "The Economist" style—sharp, intellectual, slightly witty, but never academic or dry.

# Response Format (Strict JSON, no markdown)
{
  "question": "A punchy, analytical question (max 120 chars).",
  "options": [
    "Correct Answer (The Insight)",
    "Plausible Alternative 1 (The Trap)",
    "Plausible Alternative 2 (The Related Event)",
    "Plausible Alternative 3 (The Logical Misconception)"
  ],
  "correctIndex": 0,
  "tldr": "Sentence 1: The 'Big Picture' takeaway. Sentence 2: The long-term implication or 'So What?'.",
  "depthScore": 7,
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
    if (parsed[key] === undefined) {
      throw new Error(`Claude response missing field "${key}" for category "${categoryId}"`);
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
