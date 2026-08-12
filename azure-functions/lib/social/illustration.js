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
import { parseJSONFromLLM } from "./mcq.js";
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

// Key the scene off the story's SPINE — the cover HOOK (the swipe-earning angle
// the cover promises) plus the headline + summary — rather than the first three
// key points. The hook is what the imagery should echo, so the cover art matches
// the cover copy; a couple of key points stay only as thin supporting context.
export function buildConceptPrompt(story, hook = "") {
  const facts = keyPointStrings(story).slice(0, 2).map((k) => `- ${k}`).join("\n") || "(none)";
  const hookLine = hook ? `Cover hook (the angle to echo): ${hook}\n` : "";
  return `${hookLine}Headline: ${story?.headline}
Summary: ${story?.summary}
Supporting context:
${facts}

Write the scene now.`;
}

// House style wrapper — every illustration reads as Quydly and stays safe.
export function buildImagePrompt(scene) {
  return `Flat modern editorial vector illustration. Bold simple geometric shapes, clean lines, a limited palette over a deep navy (#0B0F1A) background, soft depth and a subtle grain. Generic anonymous stylized figures only — NO real or recognizable faces, NO text or letters, NO brand logos. Scene: ${scene}`;
}

async function writeScene({ anthropic, story, hook = "", logger }) {
  try {
    const msg = await anthropic.messages.create({
      model: CONCEPT_MODEL, max_tokens: 160,
      system: ILLUSTRATION_CONCEPT_SYSTEM,
      messages: [{ role: "user", content: buildConceptPrompt(story, hook) }],
    });
    logLlmUsage(logger, "social.illustration_scene", msg, { story_id: story?.id });
    const scene = parseJSONFromLLM(msg?.content?.[0]?.text)?.scene;
    return typeof scene === "string" ? scene.trim() : "";
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "illustration_concept_failed", story_id: story?.id, error: err.message }));
    return "";
  }
}

// Call OpenAI gpt-image-1 → PNG Buffer (or null). gpt-image-1 returns base64.
// MEDIUM quality: the illustration always sits BEHIND the slide scrim (detail is
// hidden), so medium is materially cheaper for no visible loss vs high.
async function renderImage({ openaiKey, prompt, fetchImpl = fetch, logger }) {
  try {
    const res = await fetchImpl(OPENAI_IMAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, size: IMAGE_SIZE, quality: "medium" }),
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
export async function generateIllustration({ anthropic, openaiKey, story, hook = "", fetchImpl, logger } = {}) {
  if (!anthropic || !openaiKey || !story) return null;
  const scene = await writeScene({ anthropic, story, hook, logger });
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

// Human label for each carousel slide an illustration can back — so the scene
// writer knows WHICH section each scene is for (they map positionally to the
// photo-less slots, which may SKIP the cover when it has a photo).
const SCENE_ROLE = {
  cover: "the opening / headline moment",
  what: "what happened",
  numbers: "the key numbers behind the story",
  keypoints: "the key facts",
  why: "why it matters",
  content: "the story",
};

// `kinds` is the ORDERED list of slide roles the scenes will back (from
// plannedIllustrationKinds) — NOT necessarily slide 1..N, since photo-backed
// slides are skipped. Each scene is described against its real role, and ONLY the
// cover scene (when present) is told to echo the hook; when the cover is
// photo-backed it is absent from `kinds`, so no body scene is mis-framed as it.
export function buildScenesPrompt(story, kinds, hook = "") {
  const facts = keyPointStrings(story).slice(0, 2).map((k) => `- ${k}`).join("\n") || "(none)";
  const list = kinds.map((k, i) => {
    const role = SCENE_ROLE[k] || SCENE_ROLE.content;
    const echo = k === "cover" && hook ? ` — this scene MUST echo the cover hook: "${hook}"` : "";
    return `${i + 1}. ${role}${echo}`;
  }).join("\n");
  // When the cover isn't among the slots, the hook is still the story's angle —
  // keep every scene consistent with it, but don't force one to be a cover shot.
  const angle = hook && !kinds.includes("cover") ? `Overall story angle to stay consistent with: ${hook}\n` : "";
  return `Produce exactly ${kinds.length} distinct scenes — one for each carousel slide below, IN THIS ORDER:
${list}
${angle}Headline: ${story?.headline}
Summary: ${story?.summary}
Supporting context:
${facts}

Write the ${kinds.length} scenes now.`;
}

async function writeScenes({ anthropic, story, kinds, hook = "", logger }) {
  try {
    const count = kinds.length;
    const msg = await anthropic.messages.create({
      model: CONCEPT_MODEL, max_tokens: 80 + count * 60,
      system: ILLUSTRATION_SCENES_SYSTEM,
      messages: [{ role: "user", content: buildScenesPrompt(story, kinds, hook) }],
    });
    logLlmUsage(logger, "social.illustration_scenes", msg, { story_id: story?.id, scene_count: count });
    const scenes = parseJSONFromLLM(msg?.content?.[0]?.text)?.scenes;
    return Array.isArray(scenes) ? scenes.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : [];
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "illustration_scenes_failed", story_id: story?.id, error: err.message }));
    return [];
  }
}

// Generate one distinct illustration per slot → array aligned to the scenes, each
// { buffer, contentType, scene } or null (a per-image failure doesn't sink the
// others). Slots come from `kinds` (the ordered photo-less slide roles) so each
// scene is framed for its real slide; `count` is a legacy fallback that makes N
// generic slots. Returns [] when disabled or the scene write fails. Images render
// in parallel.
export async function generateIllustrations({ anthropic, openaiKey, story, kinds = null, count = 1, hook = "", fetchImpl, logger } = {}) {
  // Prefer explicit slide KINDS (so each scene is framed for its real slot); fall
  // back to N generic "content" slots when only a count is supplied (legacy path).
  const slotKinds = Array.isArray(kinds) && kinds.length ? kinds : Array.from({ length: Math.max(0, count) }, () => "content");
  if (!anthropic || !openaiKey || !story || !slotKinds.length) return [];
  const scenes = (await writeScenes({ anthropic, story, kinds: slotKinds, hook, logger })).slice(0, slotKinds.length);
  if (!scenes.length) return [];
  return Promise.all(scenes.map(async (scene) => {
    const buffer = await renderImage({ openaiKey, prompt: buildImagePrompt(scene), fetchImpl, logger });
    return buffer ? { buffer, contentType: "image/png", scene } : null;
  }));
}
