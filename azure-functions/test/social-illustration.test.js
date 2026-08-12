#!/usr/bin/env node
// Unit tests for the editorial-illustration generator — no network.
// Usage: node --test test/social-illustration.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIllustration, generateIllustrations, buildImagePrompt, buildScenesPrompt } from "../lib/social/illustration.js";

const STORY = { id: 5, headline: "Exam glitch strands students", summary: "A technical fault disrupted a national entrance exam.", key_points: ["Servers failed", "Students stranded"] };
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const anthropicReturning = (scene) => ({ messages: { create: async () => ({ content: [{ text: JSON.stringify({ scene }) }] }) } });
const openaiOk = () => async () => ({ ok: true, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) });

test("generateIllustration: scene → OpenAI image → PNG buffer", async () => {
  const out = await generateIllustration({
    anthropic: anthropicReturning("stylized stressed students at glitching exam terminals"),
    openaiKey: "sk-test", story: STORY, fetchImpl: openaiOk(),
  });
  assert.ok(out);
  assert.equal(out.contentType, "image/png");
  assert.ok(Buffer.isBuffer(out.buffer) && out.buffer.length > 0);
  assert.match(out.scene, /students/);
});

test("generateIllustration: missing anthropic/key/story → null", async () => {
  assert.equal(await generateIllustration({ openaiKey: "sk", story: STORY, fetchImpl: openaiOk() }), null);
  assert.equal(await generateIllustration({ anthropic: anthropicReturning("x"), story: STORY, fetchImpl: openaiOk() }), null);
  assert.equal(await generateIllustration({ anthropic: anthropicReturning("x"), openaiKey: "sk", fetchImpl: openaiOk() }), null);
});

test("generateIllustration: empty scene → null, never calls the image API", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  assert.equal(await generateIllustration({ anthropic: anthropicReturning(""), openaiKey: "sk", story: STORY, fetchImpl }), null);
  assert.equal(called, false);
});

test("generateIllustration: OpenAI non-200 → null", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
  assert.equal(await generateIllustration({ anthropic: anthropicReturning("a scene"), openaiKey: "sk", story: STORY, fetchImpl }), null);
});

const anthropicScenes = (scenes) => ({ messages: { create: async () => ({ content: [{ text: JSON.stringify({ scenes }) }] }) } });

test("generateIllustrations: N distinct scenes → N PNG buffers (aligned)", async () => {
  const out = await generateIllustrations({
    anthropic: anthropicScenes(["frozen screens", "empty desks", "a ticking clock"]),
    openaiKey: "sk", story: STORY, count: 3, fetchImpl: openaiOk(),
  });
  assert.equal(out.length, 3);
  assert.ok(out.every((r) => r && Buffer.isBuffer(r.buffer)));
  assert.deepEqual(out.map((r) => r.scene), ["frozen screens", "empty desks", "a ticking clock"]);
});

test("generateIllustrations: a single image failure nulls only that slot", async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return n === 2 ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) }; };
  const out = await generateIllustrations({ anthropic: anthropicScenes(["a", "b", "c"]), openaiKey: "sk", story: STORY, count: 3, fetchImpl });
  assert.equal(out.length, 3);
  assert.ok(out[0] && out[2]);
  assert.equal(out[1], null);
});

test("generateIllustrations: a malformed scene slot stays null and does NOT shift later scenes", async () => {
  // Claude returns an empty element mid-array. The valid key-points scene must
  // stay at slot 2 (aligned to kinds[2]="keypoints"), NOT compact onto slot 1.
  const out = await generateIllustrations({
    anthropic: anthropicScenes(["cover art", "", "key-points art"]),
    openaiKey: "sk", story: STORY, kinds: ["cover", "what", "keypoints"], fetchImpl: openaiOk(),
  });
  assert.equal(out.length, 3);
  assert.equal(out[1], null);              // malformed slot preserved as null (what → gradient)
  assert.equal(out[0].scene, "cover art");
  assert.equal(out[2].scene, "key-points art"); // did NOT shift to slot 1
});

test("generateIllustrations: no scenes → [] (no image calls)", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  assert.deepEqual(await generateIllustrations({ anthropic: anthropicScenes([]), openaiKey: "sk", story: STORY, count: 3, fetchImpl }), []);
  assert.equal(called, false);
});

test("buildScenesPrompt: only the cover scene echoes the hook, and only when the cover is a slot", () => {
  // Cover IS a slot (no cover photo): scene 1 is the cover and must echo the hook.
  const withCover = buildScenesPrompt(STORY, ["cover", "what", "keypoints"], "Why did the stock fall?");
  assert.match(withCover, /1\. the opening \/ headline moment — this scene MUST echo the cover hook: "Why did the stock fall\?"/);
  assert.match(withCover, /2\. what happened/);
  assert.match(withCover, /3\. the key facts/);

  // Cover is photo-backed → absent from kinds: NO scene may be framed as the cover,
  // and none must be told to echo the hook (the off-by-photo-slide bug). The hook
  // survives only as the general story angle.
  const noCover = buildScenesPrompt(STORY, ["what", "keypoints"], "Why did the stock fall?");
  assert.doesNotMatch(noCover, /echo the cover hook/);
  assert.doesNotMatch(noCover, /the opening \/ headline moment/);
  assert.match(noCover, /1\. what happened/);
  assert.match(noCover, /Overall story angle to stay consistent with: Why did the stock fall\?/);
});

test("buildImagePrompt: locks the house style and bans real faces/text", () => {
  const p = buildImagePrompt("a crowd of anonymous figures");
  assert.match(p, /editorial/i);
  assert.match(p, /NO real or recognizable faces/i);
  assert.match(p, /NO text/i);
  assert.match(p, /a crowd of anonymous figures/);
});
