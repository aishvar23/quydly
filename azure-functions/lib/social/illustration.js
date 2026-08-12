// AI editorial-illustration generation for IG cards — the imagery tier ABOVE the
// brand-graphic floor. When a story has no licensed photo, we generate a stylized
// illustration so the cover is never a generic gradient panel.
//
// Two steps: (1) Claude writes a SHORT, safe visual scene from the headline
// (generic anonymous figures, NEVER real/recognizable people, neutral on
// sensitive topics); (2) OpenAI gpt-image-1 renders it in a fixed flat-editorial
// house style. Both best-effort — any failure returns null and the caller falls
// back to the brand graphic. Deliberately NEVER photorealistic and NEVER a real
// likeness, so it is editorial illustration, not a misinformation/defamation risk.

import { keyPointStrings } from "./platforms/_shared.js";
import { MODEL_EDITORIAL } from "../models.js";
import { logLlmUsage } from "../llmUsage.js";

const CONCEPT_MODEL = MODEL_EDITORIAL;
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
// 3:2 landscape suits the full-width cover hero; objectFit:cover handles the rest.
const IMAGE_SIZE = "1536x1024";

export const ILLUSTRATION_CONCEPT_SYSTEM = `You turn a news headline into a SHORT visual scene for a flat editorial illustration on an Instagram news card.

RULES
- One sentence, <= 25 words, describing a CONCRETE scene built from GENERIC, anonymous figures or objects — NEVER a real, named, or recognizable person, face, or brand logo.
- Convey the story's core situation or emotion (confusion, tension, growth, conflict, relief) through what's happening in the scene, not through any text.
- Neutral and non-graphic for sensitive subjects (death, violence, disaster): suggest it symbolically (a single candle, an empty chair, storm clouds) — never gore, never identifiable victims.
- No text, words, captions, or logos in the scene.

Respond ONLY with JSON, no markdown: { "scene": "..." }`;

export function buildConceptPrompt(story) {
  const facts = keyPointStrings(story).slice(0, 3).map((k) => `- ${k}`).join("\n") || "(none)";
  return `Headline: ${story?.headline}
Summary: ${story?.summary}
Key points:
${facts}

Write the scene now.`;
}

// House style wrapper — every illustration reads as Quydly and stays safe.
export function buildImagePrompt(scene) {
  return `Flat modern editorial vector illustration. Bold simple geometric shapes, clean lines, a limited palette over a deep navy (#0B0F1A) background, soft depth and a subtle grain. Generic anonymous stylized figures only — NO real or recognizable faces, NO text or letters, NO brand logos. Scene: ${scene}`;
}

async function writeScene({ anthropic, story, logger }) {
  try {
    const msg = await anthropic.messages.create({
      model: CONCEPT_MODEL, max_tokens: 160,
      system: ILLUSTRATION_CONCEPT_SYSTEM,
      messages: [{ role: "user", content: buildConceptPrompt(story) }],
    });
    logLlmUsage(logger, "social.illustration_scene", msg, { story_id: story?.id });
    const raw = String(msg?.content?.[0]?.text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const scene = JSON.parse(raw)?.scene;
    return typeof scene === "string" ? scene.trim() : "";
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "illustration_concept_failed", story_id: story?.id, error: err.message }));
    return "";
  }
}

// Call OpenAI gpt-image-1 → PNG Buffer (or null). gpt-image-1 returns base64.
async function renderImage({ openaiKey, prompt, fetchImpl = fetch, logger }) {
  try {
    const res = await fetchImpl(OPENAI_IMAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, size: IMAGE_SIZE, quality: "high" }),
    });
    if (!res.ok) {
      logger?.warn?.(JSON.stringify({ event: "illustration_image_http", status: res.status }));
      return null;
    }
    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || !b64) return null;
    return Buffer.from(b64, "base64");
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "illustration_image_failed", error: err.message }));
    return null;
  }
}

// Generate a story illustration → { buffer (PNG), contentType, scene } or null.
// Best-effort and additive: any missing input or failure returns null.
export async function generateIllustration({ anthropic, openaiKey, story, fetchImpl, logger } = {}) {
  if (!anthropic || !openaiKey || !story) return null;
  const scene = await writeScene({ anthropic, story, logger });
  if (!scene) return null;
  const buffer = await renderImage({ openaiKey, prompt: buildImagePrompt(scene), fetchImpl, logger });
  if (!buffer) return null;
  return { buffer, contentType: "image/png", scene };
}

// One Claude call → `count` DISTINCT scenes (different angles/moments of the same
// story), so a multi-slide carousel doesn't repeat one illustration.
export const ILLUSTRATION_SCENES_SYSTEM = `You turn a news story into a set of DISTINCT visual scenes for flat editorial illustrations across an Instagram news carousel — one per slide. Each scene is a DIFFERENT angle, moment, or metaphor of the same story (e.g. the trigger, the people affected, the response, the bigger picture).

RULES (apply to EVERY scene)
- One sentence each, <= 25 words, a CONCRETE scene of GENERIC anonymous figures or objects — NEVER a real, named, or recognizable person, face, or brand logo.
- The set must be visibly varied — do not restate the same composition.
- Convey the situation/emotion through the scene, not text. No words, captions, or logos in any scene.
- Neutral and symbolic for sensitive subjects (death, violence, disaster) — never gore or identifiable victims.

Respond ONLY with JSON, no markdown: { "scenes": ["...", "..."] }`;

export function buildScenesPrompt(story, count) {
  const facts = keyPointStrings(story).slice(0, 3).map((k) => `- ${k}`).join("\n") || "(none)";
  return `Produce exactly ${count} distinct scenes.
Headline: ${story?.headline}
Summary: ${story?.summary}
Key points:
${facts}

Write the ${count} scenes now.`;
}

async function writeScenes({ anthropic, story, count, logger }) {
  try {
    const msg = await anthropic.messages.create({
      model: CONCEPT_MODEL, max_tokens: 80 + count * 60,
      system: ILLUSTRATION_SCENES_SYSTEM,
      messages: [{ role: "user", content: buildScenesPrompt(story, count) }],
    });
    logLlmUsage(logger, "social.illustration_scenes", msg, { story_id: story?.id, scene_count: count });
    const raw = String(msg?.content?.[0]?.text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const scenes = JSON.parse(raw)?.scenes;
    return Array.isArray(scenes) ? scenes.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : [];
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "illustration_scenes_failed", story_id: story?.id, error: err.message }));
    return [];
  }
}

// Generate up to `count` distinct illustrations → array aligned to the scenes,
// each { buffer, contentType, scene } or null (a per-image failure doesn't sink
// the others). Returns [] when disabled or the scene write fails. Images render
// in parallel.
export async function generateIllustrations({ anthropic, openaiKey, story, count = 1, fetchImpl, logger } = {}) {
  if (!anthropic || !openaiKey || !story || count < 1) return [];
  const scenes = (await writeScenes({ anthropic, story, count, logger })).slice(0, count);
  if (!scenes.length) return [];
  return Promise.all(scenes.map(async (scene) => {
    const buffer = await renderImage({ openaiKey, prompt: buildImagePrompt(scene), fetchImpl, logger });
    return buffer ? { buffer, contentType: "image/png", scene } : null;
  }));
}
