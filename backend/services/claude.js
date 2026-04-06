import Anthropic from "@anthropic-ai/sdk";

// Lazy client — initialized on first call so that dotenv has already been
// loaded by the time this runs (ES module imports are hoisted above any
// dotenv.config() call in the importing file).
let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const REQUIRED_KEYS = ["question", "options", "correctIndex", "tldr", "categoryId"];
const MAX_RETRIES = 3;

/**
 * Generate one multiple-choice question from a headline.
 * Returns null if the story fails the hard-news filter or exhausts retries.
 *
 * @param {{ title: string, description: string }} headline
 * @param {string} categoryId     — e.g. "world", "politics"
 * @param {string} categoryLabel  — e.g. "World News", "Politics"
 * @returns {Promise<{ question, options, correctIndex, tldr, categoryId } | null>}
 */
export async function generateQuestion(headline, categoryId, categoryLabel) {
  const prompt = `# Role
You are a rigorous, elite news analyst for Quydly. Your audience is composed of "smart-curious" adults who hate superficial trivia and demand substance.

# The "Signal vs. Noise" Filter — Apply First
**REJECT all non-consequential content.** Immediately discard stories regarding lifestyle trends, cultural "fluff," office sociology, celebrity activity, or individual human-interest pieces. If the story describes a "vibe," a "trend," or a "feeling" rather than a structural change, it is ineligible.

# The "Hard News" Mandate
Only proceed if the news documents a concrete shift in:
1. **Institutional Power:** New laws, treaties, election outcomes, or geopolitical realignments.
2. **Macro-Economics:** Central bank actions, supply chain disruptions, or multi-billion dollar market pivots.
3. **Strategic Tech:** Infrastructure-level changes in AI, semiconductors, energy, or cybersecurity.
4. **Verified Science:** Peer-reviewed breakthroughs that challenge existing models.

# The Objective Truth Test
- **Discard:** Subjective opinions, "expert" predictions, or soft cultural observations.
- **Accept:** Demonstrable facts, legislative milestones, or documented strategic pivots by major global actors.
- **The Question:** Must test the user's understanding of *why* this specific event changes the status quo.

# Input Data
- Category: ${categoryLabel}
- Headline: ${headline.title}
- Context: ${headline.description}

# Decision
**Step 1 — Filter:** Does this story meet the Hard News Mandate above?
- If NO → respond with exactly: {"rejected": true, "reason": "<one-line reason>"}
- If YES → proceed to Step 2.

**Step 2 — Generate Question** using the Quydly Framework:
1. **The "Non-Obvious" Rule:** The answer must NOT be found simply by glancing at the headline. Require synthesis of the Context.
2. **Focus on "Second-Order Effects":** Ask "What does this signal for the industry/region?" not "What happened?"
3. **Plausible Distractors:** Use half-truths or related current events — never joke answers.
4. **Tone:** The Economist style — sharp, intellectual, slightly witty, never dry or academic.

# Response Format (strict JSON, no markdown, no extra text)
If accepted:
{
  "question": "A punchy, analytical question (max 120 chars).",
  "options": [
    "Correct Answer (The Insight)",
    "Plausible Alternative 1 (The Trap)",
    "Plausible Alternative 2 (The Related Event)",
    "Plausible Alternative 3 (The Logical Misconception)"
  ],
  "correctIndex": 0,
  "tldr": "Sentence 1: The Big Picture takeaway. Sentence 2: The long-term implication or So What?",
  "depthScore": 7,
  "categoryId": "${categoryId}"
}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let raw;
    try {
      const message = await getClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
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

    // Content rejected by the hard-news filter — no point retrying
    if (parsed.rejected === true) {
      console.log(`[claude] rejected "${categoryId}" — ${parsed.reason ?? "failed hard-news filter"}: ${headline.title.slice(0, 60)}`);
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
