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
 * Generate one crisp, high-information-density question from an enriched article.
 * Returns null if the story is rejected or exhausts retries.
 *
 * @param {{ title: string, description?: string, enrichedContext: string, signalScore: number }} article
 * @param {string} categoryId     — e.g. "world", "politics"
 * @param {string} categoryLabel  — e.g. "World News", "Politics"
 * @returns {Promise<{ question, options, correctIndex, insight_tldr, categoryId } | null>}
 */
export async function generateQuestion(article, categoryId, categoryLabel) {
  const descriptionLine = article.description
    ? `\nDescription: ${article.description}`
    : "";

  const prompt = `# Role
You are a Technical Auditor and Intelligence Briefing Officer.

# Task
Generate ONE crisp, high-information-density question based ONLY on the provided enriched text.

# Technical Directives
- **Zero Philosophy:** No questions about 'societal impact', 'ethical considerations', or 'the future of...'.
- **The 50% Rule:** At least 50% of the question must consist of technical terms, proper nouns, or quantitative data points found in the text.
- **The 'Directed' Test:** The question must be so specific to the provided text that even a general expert would need to read this article to answer correctly.
- **Crispness:** The question must be under 125 characters.

# Examples for Calibration

[BAD QUESTION (Philosophical/Vague)]:
"How will the new EU AI Act impact the future of innovation in the tech sector?"
(Reason: Too broad, no data points, common sense answers.)

[GOOD QUESTION (Directed/Crisp)]:
"Under the EU AI Act, what is the specific Euro fine for providers failing to comply with Article 52 transparency rules?"
(Reason: Anchored on a specific Article and a specific penalty.)

[BAD QUESTION (Philosophical/Vague)]:
"Why are central banks concerned about the potential for rising global inflation?"
(Reason: General knowledge, lacks technical specificity.)

[GOOD QUESTION (Directed/Crisp)]:
"Which specific 10-year Treasury yield threshold did the Fed cite as the primary trigger for the Q3 liquidity injection?"
(Reason: Anchored on a specific asset class, a timeframe, and an operational action.)

# Question Format
- **Anchor:** Start with a specific entity, number, or data point.
- **Action:** Ask about a specific mechanism, threshold, or result.
- **Target:** The correct answer must be a hard fact, not an interpretation.

# Distractor Logic
- Option index 0 — Correct Answer: the hard fact from the text.
- Option index 1 — The 'Half-Truth': something true in a different context, plausible to a casual reader.
- Option index 2 — The 'Surface Fact': the obvious thing a lazy reader would guess from the headline.
- Option index 3 — The 'Logical Misconception': an intuitive but incorrect deduction from the facts.

# Input Data
- Category: ${categoryLabel}
- Headline: ${article.title}${descriptionLine}
- Text: ${article.enrichedContext}

# Output (strict JSON, no markdown, no extra text)
{
  "question": "Under 125 chars. Anchor on a specific entity, number, or data point.",
  "options": [
    "Correct Hard Fact",
    "Half-Truth (Plausible Trap)",
    "Surface Fact (The Obvious Answer)",
    "Logical Misconception (Intuitive but Wrong)"
  ],
  "correctIndex": 0,
  "insight_tldr": "One or two sentences: what is the specific fact and why does it matter?",
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
