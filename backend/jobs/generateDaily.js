import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, EDITORIAL_MIX } from "../../config/categories.js";
import { fetchStoriesForCategory as fetchHeadline } from "../services/articleStore.js";
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

function buildCategoryQueue() {
  const byId = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const queue = [];
  for (const [id, count] of Object.entries(EDITORIAL_MIX)) {
    for (let i = 0; i < count; i++) {
      queue.push(byId[id]);
    }
  }
  return queue;
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

  const questions = [];
  for (const category of categoryQueue) {
    console.log(`[generateDaily] processing category "${category.id}"`);
    const headline = await fetchHeadline(category.id);
    const question = await generateQuestion(headline, category.id);
    questions.push(question);
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
