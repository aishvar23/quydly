#!/usr/bin/env node
// Unit tests for the editorial-illustration generator — no network.
// Usage: node --test test/social-illustration.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIllustration, generateIllustrations, buildImagePrompt } from "../lib/social/illustration.js";

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

test("generateIllustrations: no scenes → [] (no image calls)", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  assert.deepEqual(await generateIllustrations({ anthropic: anthropicScenes([]), openaiKey: "sk", story: STORY, count: 3, fetchImpl }), []);
  assert.equal(called, false);
});

test("buildImagePrompt: locks the house style and bans real faces/text", () => {
  const p = buildImagePrompt("a crowd of anonymous figures");
  assert.match(p, /editorial/i);
  assert.match(p, /NO real or recognizable faces/i);
  assert.match(p, /NO text/i);
  assert.match(p, /a crowd of anonymous figures/);
});
