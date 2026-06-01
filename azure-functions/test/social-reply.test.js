#!/usr/bin/env node
// Unit tests for the X "answer here" reply feature (no network — fake fetch +
// mock Supabase + fake Anthropic).
//
// Usage: node --test test/social-reply.test.js
//
// Covers: x.publishReply client · x.generateQuizQuestion validation ·
//         x.formatQuestionTweet budget · publisher posts the reply after an X
//         publish (and only when a social_question_id is present).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  publishReply as xPublishReply,
  generateQuizQuestion,
  formatQuestionTweet,
  weightedLength,
} from "../lib/social/platforms/x.js";
import * as x from "../lib/social/platforms/x.js";
import { publishApprovedPosts } from "../lib/social/social-publisher.js";
import { generatePlatformPost } from "../lib/social/social-post-generator.js";

const CREDS = { consumerKey: "k", consumerSecret: "s", token: "t", tokenSecret: "ts" };
const STORY = {
  id: 42,
  headline: "Central bank holds rates steady amid cooling inflation",
  summary: "The decision keeps borrowing costs unchanged for a third meeting.",
  key_points: ["Rates unchanged", "Inflation easing", "Markets had expected a hold"],
  category_id: "finance",
};

// ── x.publishReply ──────────────────────────────────────────────────────────────

test("x.publishReply: posts text with reply.in_reply_to_tweet_id and OAuth header", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ data: { id: "999" } }) };
  };
  const out = await xPublishReply({
    text: "Check out the answer here: https://quydly.com/question/abc",
    inReplyToTweetId: "555",
    creds: CREDS,
    fetchImpl,
  });
  assert.equal(out.platformPostId, "999");
  assert.equal(captured.url, "https://api.x.com/2/tweets");
  assert.match(captured.opts.headers.Authorization, /^OAuth /);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.reply.in_reply_to_tweet_id, "555");
  assert.match(body.text, /quydly\.com\/question\/abc/);
});

test("x.publishReply: throws when the parent tweet id is missing", async () => {
  await assert.rejects(
    () => xPublishReply({ text: "x", inReplyToTweetId: null, creds: CREDS }),
    /missing parent tweet id/
  );
});

// ── x.generateQuizQuestion ──────────────────────────────────────────────────────

function fakeAnthropic(text) {
  return { messages: { create: async () => ({ content: [{ text }] }) } };
}

test("generateQuizQuestion: returns a normalized MCQ on valid JSON", async () => {
  const anthropic = fakeAnthropic(JSON.stringify({
    question: "  What did the central bank do to rates?  ",
    options: [" Held them ", "Cut them", "Raised them", "Abolished them"],
    correctIndex: 0,
    tldr: "Rates were held for a third meeting. Inflation is cooling.",
  }));
  const q = await generateQuizQuestion({ anthropic, story: STORY, audienceGeo: "global" });
  assert.equal(q.question, "What did the central bank do to rates?");
  assert.equal(q.options[0], "Held them"); // trimmed
  assert.equal(q.correctIndex, 0);
  assert.match(q.tldr, /third meeting/);
});

test("generateQuizQuestion: returns null on invalid shape (wrong option count)", async () => {
  const anthropic = fakeAnthropic(JSON.stringify({
    question: "Q?", options: ["a", "b"], correctIndex: 0, tldr: "x. y.",
  }));
  const q = await generateQuizQuestion({ anthropic, story: STORY, audienceGeo: "global" });
  assert.equal(q, null);
});

test("generateQuizQuestion: returns null (never throws) on bad JSON", async () => {
  const anthropic = fakeAnthropic("not json at all");
  const q = await generateQuizQuestion({ anthropic, story: STORY, audienceGeo: "global" });
  assert.equal(q, null);
});

// ── x.formatQuestionTweet ───────────────────────────────────────────────────────

test("formatQuestionTweet: includes the question, carries no URL, stays within 280 weighted", () => {
  const question = { question: "What did the central bank do to rates?", options: ["a","b","c","d"], correctIndex: 0, tldr: "x. y." };
  const draft = formatQuestionTweet(question, STORY, "global");
  assert.match(draft.text, /What did the central bank do to rates\?/);
  assert.equal(draft.linkUrl, null);
  assert.doesNotMatch(draft.text, /https?:\/\//);
  assert.ok(weightedLength(draft.text) <= 280, `weighted length ${weightedLength(draft.text)} > 280`);
});

test("formatQuestionTweet: hard-caps a very long question to stay within 280 weighted", () => {
  const longQ = `Which ${"extremely ".repeat(60)}long-winded question is this?`;
  const draft = formatQuestionTweet({ question: longQ, options: ["a","b","c","d"], correctIndex: 0, tldr: "x. y." }, STORY, "global");
  assert.ok(weightedLength(draft.text) <= 280, `weighted length ${weightedLength(draft.text)} > 280`);
  assert.match(draft.text, /Reply with your answer/);
});

test("formatQuestionTweet: strips a URL embedded in the question (X carries no link)", () => {
  const draft = formatQuestionTweet(
    { question: "See https://evil.example.com/x — who won the vote?", options: ["a","b","c","d"], correctIndex: 0, tldr: "x. y." },
    STORY, "global"
  );
  assert.doesNotMatch(draft.text, /https?:\/\//);
  assert.doesNotMatch(draft.text, /evil\.example\.com/);
});

// ── generatePlatformPost X branch (card leak + fallback) ────────────────────────

test("generatePlatformPost: X question draft is TEXT-ONLY (never the headline card, which would leak the answer)", async () => {
  const anthropic = fakeAnthropic(JSON.stringify({
    question: "What did the central bank do to rates?", options: ["Held","Cut","Raised","Ended"], correctIndex: 0, tldr: "x. y.",
  }));
  const cardService = { getCardUrl: async () => "https://cards.example/headline-card.png" };
  const draft = await generatePlatformPost({ platform: x, story: STORY, audienceGeo: "global", anthropic, cardService });
  assert.equal(draft.mediaUrl, null);       // card discarded — answer not revealed
  assert.equal(draft.requiresMedia, false);
  assert.ok(draft.question);                // structured question carried for persistence
  assert.match(draft.text, /central bank do to rates/);
});

test("generatePlatformPost: X falls back to deterministic draft with a SINGLE LLM call when question-gen fails", async () => {
  let calls = 0;
  const anthropic = { messages: { create: async () => { calls++; return { content: [{ text: "not json" }] }; } } };
  const draft = await generatePlatformPost({ platform: x, story: STORY, audienceGeo: "global", anthropic });
  assert.equal(calls, 1);                   // no second (engagement-copy) completion
  assert.equal(draft.question, undefined);  // no question persisted
  assert.ok(draft.text);                    // deterministic format() tweet still produced
});

// ── Publisher posts the reply after an X publish ────────────────────────────────

function makeSupabase({ duePosts, counts = {} }) {
  const byId = new Map(duePosts.map((p) => [p.id, { ...p }]));
  function from() {
    const q = { op: "select", filters: {}, payload: null, count: false, single: false };
    q.select = (_cols, opts) => { if (opts && opts.head) q.count = true; return q; };
    q.update = (payload) => { q.op = "update"; q.payload = payload; return q; };
    q.eq = (k, v) => { q.filters[k] = v; return q; };
    q.in = (k, v) => { q.filters[`in_${k}`] = v; return q; };
    q.is = (k, v) => { q.filters[`is_${k}`] = v; return q; };
    q.or = () => q; q.gte = () => q; q.lte = () => q; q.order = () => q; q.limit = () => q;
    q.maybeSingle = () => { q.single = true; return resolve(q); };
    q.then = (res, rej) => resolve(q).then(res, rej);
    return q;
  }
  async function resolve(q) {
    if (q.op === "update") {
      const post = byId.get(q.filters.id);
      if (q.single) {
        const ok = post && post.platform_post_id == null && ["APPROVED", "SCHEDULED"].includes(post.status);
        if (ok) { post.status = "PUBLISHING"; return { data: { id: q.filters.id }, error: null }; }
        return { data: null, error: null };
      }
      if (post) Object.assign(post, q.payload);
      return { error: null };
    }
    if (q.count) return { count: counts[q.filters.platform] || 0, error: null };
    return { data: duePosts, error: null };
  }
  return { client: { from }, byId };
}

const CREDS_FN = () => CREDS;

function xPost(id, over = {}) {
  return { id, story_id: 1, platform: "x", audience_geo: "global", post_text: "Q? quydly",
    media_url: null, status: "APPROVED", scheduled_for: null, platform_post_id: null,
    social_question_id: null, ...over };
}

test("publisher: posts a reply with the answer link after an X publish", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a", { social_question_id: "Q-UUID" })] });
  const publishers = { x: async () => ({ platformPostId: "tweet1", rawResponse: { data: { id: "tweet1" } } }) };
  const replies = [];
  const xReplyPublish = async (args) => { replies.push(args); return { platformPostId: "reply1" }; };

  const res = await publishApprovedPosts({
    supabase: sb.client, publishers, getCreds: CREDS_FN, xReplyPublish,
    env: { QUYDLY_PUBLIC_BASE_URL: "https://quydly.com" },
  });

  assert.equal(res.published, 1);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].inReplyToTweetId, "tweet1");
  assert.match(replies[0].text, /https:\/\/quydly\.com\/question\/Q-UUID/);
});

test("publisher: no reply when the post has no social_question_id", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a")] }); // social_question_id null
  const publishers = { x: async () => ({ platformPostId: "tweet1", rawResponse: {} }) };
  const replies = [];
  const xReplyPublish = async (args) => { replies.push(args); return { platformPostId: "r" }; };

  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getCreds: CREDS_FN, xReplyPublish, env: {} });
  assert.equal(res.published, 1);
  assert.equal(replies.length, 0);
});

test("publisher: a reply failure is non-fatal (parent stays POSTED)", async () => {
  const sb = makeSupabase({ duePosts: [xPost("a", { social_question_id: "Q" })] });
  const publishers = { x: async () => ({ platformPostId: "tweet1", rawResponse: {} }) };
  const xReplyPublish = async () => { throw new Error("reply boom"); };

  const res = await publishApprovedPosts({ supabase: sb.client, publishers, getCreds: CREDS_FN, xReplyPublish, env: {} });
  assert.equal(res.published, 1);
  assert.equal(res.failed, 0);
  assert.equal(sb.byId.get("a").status, "POSTED");
});
