import Anthropic from "@anthropic-ai/sdk";

// Lazy client — initialized on first call so that dotenv has already been
// loaded by the time this runs (ES module imports are hoisted above any
// dotenv.config() call in the importing file).
let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const REQUIRED_KEYS = ["question", "options", "correctIndex", "insight_tldr", "categoryId"];
const MAX_RETRIES = 3;

/**
 * Generate one Level-4 multiple-choice question from an enriched article.
 * Returns null if the story is rejected or exhausts retries.
 *
 * @param {{ title: string, enrichedContext: string, signalScore: number }} article
 * @param {string} categoryId     — e.g. "world", "politics"
 * @param {string} categoryLabel  — e.g. "World News", "Politics"
 * @returns {Promise<{ question, options, correctIndex, insight_tldr, categoryId } | null>}
 */
export async function generateQuestion(article, categoryId, categoryLabel) {
  const prompt = `# Role
You are a Senior Intelligence Analyst generating a 'Level 4' depth question for the Quydly platform. Your audience demands systemic insight, not surface recall.

# Input Data
- Category: ${categoryLabel}
- Headline: ${article.title}
- Full Scraped Text: ${article.enrichedContext}
- Signal Score: ${article.signalScore}

# The Synthesis Mandate
1. **Locate the 'Invisible Lever':** Do not ask about the headline. Read the Full Scraped Text to find a specific causal mechanism, a secondary economic constraint, or a geopolitical tension that is not obvious from the headline alone.
2. **Avoid 'What'—Ask 'Why' or 'How':** The question must require the user to understand the *logic* of the event, not just the *fact* of the event.
3. **The Distractor Logic:**
   - Option index 0 — Correct Strategic Insight: the non-obvious answer found only by reading the full text.
   - Option index 1 — The 'Half-Truth': something true in a different context, plausible to a casual reader.
   - Option index 2 — The 'Surface Fact': the obvious thing a lazy reader would guess from the headline.
   - Option index 3 — The 'Logical Misconception': an intuitive but incorrect deduction from the facts.
4. **Tone:** Sharp, professional, high-information density. No corporate fluff, no vague generalities.

# Rejection Rule
If the Full Scraped Text contains no causal mechanism, structural shift, or systemic implication worth a Level-4 question, respond with exactly:
{"rejected": true, "reason": "<one-line reason>"}

# Output (strict JSON, no markdown, no extra text)
{
  "question": "Max 120 chars. Focus on the systemic shift, not the surface event.",
  "options": [
    "Correct Strategic Insight",
    "Half-Truth (Plausible Trap)",
    "Surface Fact (The Obvious Answer)",
    "Logical Misconception (Intuitive but Wrong)"
  ],
  "correctIndex": 0,
  "insight_tldr": "Explain the So What — why does this specific detail change the status quo? Two sentences max.",
  "categoryId": "${categoryId}"
}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let raw;
    try {
      const message = await getClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      });
      raw = message.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    } catch (err) {
      console.warn(`[claude] API error attempt ${attempt}/${MAX_RETRIES} for "${categoryId}":`, err.message);
      if (attempt === MAX_RETRIES) return null;
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[claude] Invalid JSON attempt ${attempt}/${MAX_RETRIES} for "${categoryId}":`, raw.slice(0, 120));
      if (attempt === MAX_RETRIES) return null;
      continue;
    }

    // No causal mechanism worth a Level-4 question — no point retrying
    if (parsed.rejected === true) {
      console.log(`[claude] rejected "${categoryId}" — ${parsed.reason ?? "no systemic lever found"}: ${article.title.slice(0, 60)}`);
      return null;
    }

    // Validate required fields
    const missingKey = REQUIRED_KEYS.find((k) => parsed[k] === undefined);
    if (missingKey) {
      console.warn(`[claude] missing field "${missingKey}" attempt ${attempt}/${MAX_RETRIES} for "${categoryId}"`);
      if (attempt === MAX_RETRIES) return null;
      continue;
    }
    if (!Array.isArray(parsed.options) || parsed.options.length !== 4) {
      console.warn(`[claude] bad options array attempt ${attempt}/${MAX_RETRIES} for "${categoryId}"`);
      if (attempt === MAX_RETRIES) return null;
      continue;
    }
    if (typeof parsed.correctIndex !== "number" || parsed.correctIndex < 0 || parsed.correctIndex > 3) {
      console.warn(`[claude] bad correctIndex attempt ${attempt}/${MAX_RETRIES} for "${categoryId}"`);
      if (attempt === MAX_RETRIES) return null;
      continue;
    }

    return parsed;
  }

  return null;
}
