require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const Redis = require("ioredis");
const { createClient } = require("@supabase/supabase-js");
const { CATEGORIES, EDITORIAL_MIX } = require("../../config/categories");
const { fetchHeadline } = require("../services/newsdata");
const { generateQuestion } = require("../services/claude");

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
 * Expand EDITORIAL_MIX into an ordered array of category objects.
 * e.g. { world: 2, tech: 1 } → [worldCategory, worldCategory, techCategory]
 */
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
  return `questions:${new Date().toISOString().slice(0, 10)}`; // "questions:YYYY-MM-DD"
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function cacheInRedis(redis, key, questions) {
  await redis.set(key, JSON.stringify(questions), "EX", 86400); // TTL: 24 hours
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

async function generateDaily() {
  console.log("[generateDaily] starting pipeline");

  const redis = buildRedisClient();
  const supabase = buildSupabaseClient();
  const categoryQueue = buildCategoryQueue();
  const date = new Date().toISOString().slice(0, 10);

  // Generate one question per slot in the mix
  const questions = [];
  for (const category of categoryQueue) {
    console.log(`[generateDaily] processing category "${category.id}"`);
    const headline = await fetchHeadline(category.newsDataTag);
    const question = await generateQuestion(headline, category.id);
    questions.push(question);
  }

  console.log(`[generateDaily] generated ${questions.length} questions`);

  // Persist — Redis primary, Supabase fallback
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

  console.log("[generateDaily] done");
  return questions;
}

// Allow running directly: node backend/jobs/generateDaily.js
if (require.main === module) {
  generateDaily().catch((err) => {
    console.error("[generateDaily] fatal:", err);
    process.exit(1);
  });
}

module.exports = { generateDaily };
