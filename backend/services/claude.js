import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = "claude-sonnet-4-20250514";

const REQUIRED_KEYS  = ["question", "options", "correctIndex", "tldr", "categoryId"];
const CRITIQUE_MIN   = 4; // minimum score on every critique dimension

// ── Pass 1: central-fact selection + question generation ──────────────────

async function generateWithFactSelection(story, categoryId) {
  const hasKeyPoints = Array.isArray(story.key_points) && story.key_points.length > 0;

  const storyContext = hasKeyPoints
    ? `Title: ${story.title}
Summary: ${story.description}
Verified facts (from ${story.source_count ?? "multiple"} sources):
${story.key_points.map((kp, i) => `${i + 1}. ${kp}`).join("\n")}`
    : `Title: ${story.title}
Summary: ${story.description}`;

  const prompt = `You are a witty news quiz writer for Quydly, a daily news game.

Generate ONE multiple-choice question from this real news story.

${storyContext}

STEP 1 — Select the central fact:
Identify the single most important, specific, verifiable fact from the main development.
Central facts come from: main_development | why_it_matters | cause_effect | leadership_change | implication | comparison_or_positioning

Do NOT select:
- Exact quotes or specific wording used by a person
- Non-central percentages, forecasts, or dates unless they are the entire story
- Side details from secondary sub-plots

If no suitable central fact exists, set skip_reason to one of:
MIXED_STORY | TOO_TRIVIAL | QUOTE_TRIVIA | NUMERIC_TRIVIA | NO_CLEAR_CENTRAL_FACT | UNSUPPORTED_FACT_RISK
and leave question/options/correctIndex/tldr as null.

STEP 2 — Write the question (only when skip_reason is null):
- Punchy, witty, jargon-free — smart but not academic
- Asks about the main development, cause/effect, implication, or leadership change
- 4 options: exactly 1 correct, 3 plausible but clearly distinct distractors
- Wrong answers must NOT be near-synonyms of each other
- TL;DR: exactly 2 sentences of story context

Respond ONLY with valid JSON, no markdown:
{
  "central_fact": "...",
  "fact_type": "main_development | why_it_matters | cause_effect | leadership_change | implication | comparison_or_positioning",
  "skip_reason": null,
  "question": "...",
  "options": ["A","B","C","D"],
  "correctIndex": 0,
  "tldr": "Two sentence string.",
  "categoryId": "${categoryId}"
}`;

  const message = await client.messages.create({
    model:      MODEL,
    max_tokens: 768,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].text.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`[claude] generateQuestion invalid JSON for "${categoryId}": ${raw.slice(0, 200)}`);
  }

  // Claude sometimes renames the tldr field — normalise it
  if (!parsed.tldr && parsed.insight_tldr) {
    parsed.tldr = parsed.insight_tldr;
    delete parsed.insight_tldr;
  }

  return parsed;
}

// ── Pass 2: critique ──────────────────────────────────────────────────────

async function critiqueQuestion(story, generated) {
  const storyContext = Array.isArray(story.key_points) && story.key_points.length > 0
    ? `Title: ${story.title}\nKey facts:\n${story.key_points.map((kp, i) => `${i + 1}. ${kp}`).join("\n")}`
    : `Title: ${story.title}\n${story.description}`;

  const prompt = `You are a quiz quality reviewer. Score this question on 5 dimensions (1–5 each).

Story:
${storyContext}

Question: ${generated.question}
Options: ${generated.options.join(" / ")}
Correct answer: "${generated.options[generated.correctIndex]}"
Central fact used: ${generated.central_fact}

Dimensions (1 = very poor, 5 = excellent):
relevance_score — tests understanding of the main story, not a side detail
intuitiveness_score — a news-aware person would find this fair and natural
centrality_score — correct answer comes from the central fact, not a subplot
distractor_quality_score — wrong answers are plausible but clearly distinct (not synonyms)
tense_correctness_score — grammar and tense are natural and unambiguous

Reject (decision: "reject") if any of:
- Question tests exact wording rather than understanding
- Correct answer is a low-signal number, date, or forecast not central to the story
- Correct answer is a side detail rather than the main development
- Wrong options are near-synonyms of each other
- Tense is awkward or logically wrong

Respond ONLY with valid JSON, no markdown:
{
  "relevance_score": 1,
  "intuitiveness_score": 1,
  "centrality_score": 1,
  "distractor_quality_score": 1,
  "tense_correctness_score": 1,
  "decision": "approve",
  "reason": "one sentence"
}`;

  const message = await client.messages.create({
    model:      MODEL,
    max_tokens: 256,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].text.trim();
  let critique;
  try {
    critique = JSON.parse(raw);
  } catch {
    throw new Error(`[claude] critique invalid JSON for "${generated.categoryId}": ${raw.slice(0, 200)}`);
  }

  return critique;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate one multiple-choice question from a story or article.
 * Returns null if the story should be skipped (no central fact or critique rejected).
 *
 * @param {{ title: string, description: string, key_points?: string[], source_count?: number }} story
 * @param {string} categoryId
 * @returns {Promise<{ question, options, correctIndex, tldr, categoryId } | null>}
 */
export async function generateQuestion(story, categoryId) {
  const generated = await generateWithFactSelection(story, categoryId);

  if (generated.skip_reason) {
    console.warn(`[claude] skip "${categoryId}" — ${generated.skip_reason}`);
    return null;
  }

  for (const key of REQUIRED_KEYS) {
    if (generated[key] === undefined || generated[key] === null || generated[key] === "") {
      throw new Error(`[claude] missing field "${key}" for "${categoryId}"`);
    }
  }
  if (!Array.isArray(generated.options) || generated.options.length !== 4) {
    throw new Error(`[claude] wrong options array for "${categoryId}"`);
  }
  if (typeof generated.correctIndex !== "number" || generated.correctIndex < 0 || generated.correctIndex > 3) {
    throw new Error(`[claude] invalid correctIndex for "${categoryId}"`);
  }

  const critique = await critiqueQuestion(story, generated);

  const scores = [
    critique.relevance_score,
    critique.intuitiveness_score,
    critique.centrality_score,
    critique.distractor_quality_score,
    critique.tense_correctness_score,
  ];

  if (critique.decision !== "approve" || scores.some(s => typeof s !== "number" || s < CRITIQUE_MIN)) {
    console.warn(
      `[claude] critique rejected "${categoryId}": ${critique.reason} (scores: ${scores.join("/")})`,
    );
    return null;
  }

  return {
    question:     generated.question,
    options:      generated.options,
    correctIndex: generated.correctIndex,
    tldr:         generated.tldr,
    categoryId:   generated.categoryId,
  };
}
