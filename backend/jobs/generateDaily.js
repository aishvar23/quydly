import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, EDITORIAL_MIX, SESSION_FIXED, SESSION_ROTATING, TOTAL_SESSIONS } from "../../config/categories.js";
import { fetchHeadlines } from "../services/newsdata.js";
import { generateQuestion } from "../services/claude.js";

// ── Clients ───────────────────────────────────────────────────────────────────

function buildRedisClient() {
  if (!process.env.REDIS_URL) return null;
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  redis.on("error", (err) => console.warn("[redis] connection error:", err.message));
  return redis;
}

function buildSupabaseClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey() {
  return `questions:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Given pools of generated questions keyed by categoryId, build the ordered
 * 50-question array: 10 sessions × [world, world, tech, rotating, business].
 * Rotating slot cycles: sports → entertainment → science → repeat.
 */
function interleaveIntoSessions(pools) {
  const ordered = [];

  for (let i = 0; i < TOTAL_SESSIONS; i++) {
    const rotatingId = SESSION_ROTATING[i % SESSION_ROTATING.length];

    // Fixed slots
    ordered.push(pools.world.shift());
    ordered.push(pools.world.shift());
    ordered.push(pools.tech.shift());
    // Rotating slot
    ordered.push(pools[rotatingId].shift());
    // Business
    ordered.push(pools.business.shift());
  }

  return ordered.filter(Boolean); // drop any undefineds if a pool ran short
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function cacheInRedis(redis, key, questions) {
  await redis.set(key, JSON.stringify(questions), "EX", 86400);
  console.log(`[redis] cached ${questions.length} questions under "${key}"`);
}

async function saveToSupabase(supabase, date, questions) {
  const { error } = await supabase
    .from("daily_questions")
    .upsert({ date, questions, generated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  console.log(`[supabase] saved ${questions.length} questions for ${date}`);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function generateDaily() {
  console.log("[generateDaily] starting pipeline");

  const redis = buildRedisClient();
  const supabase = buildSupabaseClient();
  const date = new Date().toISOString().slice(0, 10);

  // Build a lookup: categoryId → { label, newsDataTag }
  const categoryMeta = Object.fromEntries(
    CATEGORIES.map((c) => [c.id, { label: c.label, newsDataTag: c.newsDataTag }])
  );

  // ── Step 1: Fetch all headlines per category ──────────────────────────────
  console.log("[generateDaily] fetching headlines...");
  const headlinesByCategory = {};

  for (const [categoryId, count] of Object.entries(EDITORIAL_MIX)) {
    const { newsDataTag } = categoryMeta[categoryId];
    console.log(`[generateDaily] fetching ${count} headlines for "${categoryId}" (tag: ${newsDataTag})`);
    headlinesByCategory[categoryId] = await fetchHeadlines(newsDataTag, count);
    console.log(`[generateDaily] got ${headlinesByCategory[categoryId].length} headlines for "${categoryId}"`);
  }

  // ── Step 2: Generate questions for every headline ─────────────────────────
  console.log("[generateDaily] generating questions...");
  const pools = {};

  for (const [categoryId, headlines] of Object.entries(headlinesByCategory)) {
    const { label } = categoryMeta[categoryId];
    pools[categoryId] = [];

    for (const headline of headlines) {
      console.log(`[generateDaily] generating question for "${categoryId}": ${headline.title.slice(0, 60)}...`);
      const question = await generateQuestion(headline, categoryId, label);
      pools[categoryId].push(question);
    }

    console.log(`[generateDaily] pool "${categoryId}" has ${pools[categoryId].length} questions`);
  }

  // ── Step 3: Interleave into session order ─────────────────────────────────
  const questions = interleaveIntoSessions(pools);
  console.log(`[generateDaily] interleaved ${questions.length} questions across ${TOTAL_SESSIONS} sessions`);

  // ── Step 4: Persist to Redis + Supabase ───────────────────────────────────
  if (redis) {
    try {
      await redis.connect();
      await cacheInRedis(redis, todayKey(), questions);
    } catch (err) {
      console.warn("[generateDaily] Redis write failed:", err.message);
    } finally {
      redis.disconnect();
    }
  }

  await saveToSupabase(supabase, date, questions);

  console.log("[generateDaily] done");
  return questions;
}

// Allow running directly: node backend/jobs/generateDaily.js
if (process.argv[1] === __filename) {
  generateDaily().catch((err) => {
    console.error("[generateDaily] fatal:", err);
    process.exit(1);
  });
}
