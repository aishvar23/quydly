import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, EDITORIAL_MIX, SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";
import { fetchArticlePool } from "../services/articleStore.js";
import { generateQuestion } from "../services/claude.js";
import { sendDailyNotification } from "../services/email.js";

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

/**
 * Build the full category slot list for all sessions.
 * EDITORIAL_MIX defines the per-session ratio; we scale it by TOTAL_SESSIONS
 * to get the full list of TOTAL_SESSIONS * SESSION_SIZE category slots.
 * Slots are interleaved so each session gets the correct category mix.
 */
function buildCategoryQueue() {
  const byId = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const totalQuestions = SESSION_SIZE * TOTAL_SESSIONS;

  // Build one session's worth of slots (e.g. [world, world, tech, finance, culture])
  const sessionSlots = [];
  for (const [id, count] of Object.entries(EDITORIAL_MIX)) {
    for (let i = 0; i < count; i++) sessionSlots.push(byId[id]);
  }

  // Repeat for all sessions to reach totalQuestions
  const queue = [];
  while (queue.length < totalQuestions) {
    queue.push(...sessionSlots);
  }
  return queue.slice(0, totalQuestions);
}

function todayKey() {
  return `questions:${new Date().toISOString().slice(0, 10)}`;
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
  const categoryQueue = buildCategoryQueue();
  const date = new Date().toISOString().slice(0, 10);

  // Pre-fetch article pools for every category (up to 10 articles each)
  const articlePools = {};
  const poolIndexes  = {};
  for (const cat of CATEGORIES) {
    try {
      articlePools[cat.id] = await fetchArticlePool(cat.id);
      poolIndexes[cat.id]  = 0;
      console.log(`[generateDaily] fetched ${articlePools[cat.id].length} articles for "${cat.id}"`);
    } catch (err) {
      console.warn(`[generateDaily] no articles for "${cat.id}": ${err.message}`);
      articlePools[cat.id] = [];
      poolIndexes[cat.id]  = 0;
    }
  }

  /**
   * Pick the next unused article for a category.
   * Falls back to any other category that still has articles remaining.
   * Returns { article, resolvedCategoryId } or throws if all pools exhausted.
   */
  function pickArticle(preferredCategoryId) {
    // Try preferred category first
    const pool  = articlePools[preferredCategoryId];
    const idx   = poolIndexes[preferredCategoryId];
    if (pool.length > 0 && idx < pool.length) {
      poolIndexes[preferredCategoryId]++;
      return { article: pool[idx], resolvedCategoryId: preferredCategoryId };
    }

    // Fall back to any category with remaining articles
    for (const cat of CATEGORIES) {
      if (cat.id === preferredCategoryId) continue;
      const fbPool = articlePools[cat.id];
      const fbIdx  = poolIndexes[cat.id];
      if (fbPool.length > 0 && fbIdx < fbPool.length) {
        console.warn(`[generateDaily] "${preferredCategoryId}" exhausted — falling back to "${cat.id}"`);
        poolIndexes[cat.id]++;
        return { article: fbPool[fbIdx], resolvedCategoryId: cat.id };
      }
    }

    throw new Error("All article pools exhausted — cannot generate more questions");
  }

  const questions = [];
  for (const category of categoryQueue) {
    console.log(`[generateDaily] processing category "${category.id}"`);
    try {
      const { article, resolvedCategoryId } = pickArticle(category.id);
      const question = await generateQuestion(article, resolvedCategoryId);
      questions.push(question);
    } catch (err) {
      console.error(`[generateDaily] stopping early at question ${questions.length + 1}: ${err.message}`);
      break;
    }
  }

  console.log(`[generateDaily] generated ${questions.length} questions`);

  let redisOk = false;
  if (redis) {
    try {
      await redis.connect();
      await cacheInRedis(redis, todayKey(), questions);
      redisOk = true;
    } catch (err) {
      console.warn("[generateDaily] Redis unavailable, falling back to Supabase:", err.message);
    } finally {
      redis.disconnect();
    }
  }

  if (!redisOk) {
    await saveToSupabase(supabase, date, questions);
  }

  // Notify all subscribed users
  try {
    const { data: users, error } = await supabase
      .from("users")
      .select("email")
      .not("email", "is", null);
    if (error) throw error;
    const emails = users.map((u) => u.email).filter(Boolean);
    await sendDailyNotification(emails);
  } catch (err) {
    console.error("[generateDaily] email notification failed:", err.message);
  }

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
