import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, FETCH_COUNTS, EDITORIAL_MIX, SESSION_ROTATING, SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";
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
 * Build the ordered 50-question array from per-category pools.
 * Each session: world(1) + politics(1) + sports(1) + business(1) + rotating(1)
 * Rotating cycles: entertainment → science → technology → repeat
 */
function interleaveIntoSessions(pools) {
  const ordered = [];

  for (let i = 0; i < TOTAL_SESSIONS; i++) {
    const rotatingId = SESSION_ROTATING[i % SESSION_ROTATING.length];

    ordered.push(pools.world.shift());
    ordered.push(pools.politics.shift());
    ordered.push(pools.sports.shift());
    ordered.push(pools.business.shift());
    ordered.push(pools[rotatingId].shift());
  }

  return ordered.filter(Boolean);
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

  for (const [categoryId, fetchCount] of Object.entries(FETCH_COUNTS)) {
    const { newsDataTag } = categoryMeta[categoryId];
    console.log(`[generateDaily] fetching ${fetchCount} headlines for "${categoryId}" (tag: ${newsDataTag})`);
    headlinesByCategory[categoryId] = await fetchHeadlines(newsDataTag, fetchCount);
    console.log(`[generateDaily] got ${headlinesByCategory[categoryId].length} headlines for "${categoryId}"`);
  }

  // ── Step 2: Generate questions, filtering for hard news ───────────────────
  // For each category, iterate through headlines until the target question
  // count is reached. Rejected or malformed responses are skipped.
  console.log("[generateDaily] generating questions (hard-news filter active)...");
  const pools = {};

  for (const [categoryId, targetCount] of Object.entries(EDITORIAL_MIX)) {
    const { label } = categoryMeta[categoryId];
    const headlines = headlinesByCategory[categoryId];
    pools[categoryId] = [];

    for (const headline of headlines) {
      if (pools[categoryId].length >= targetCount) break;

      const question = await generateQuestion(headline, categoryId, label);

      if (question !== null) {
        pools[categoryId].push(question);
        console.log(`[generateDaily] "${categoryId}" ${pools[categoryId].length}/${targetCount} — accepted: ${headline.title.slice(0, 60)}`);
      }
    }

    if (pools[categoryId].length < targetCount) {
      console.warn(
        `[generateDaily] "${categoryId}" only reached ${pools[categoryId].length}/${targetCount} after exhausting all ${headlines.length} headlines`
      );
    } else {
      console.log(`[generateDaily] "${categoryId}" complete — ${pools[categoryId].length} questions`);
    }
  }

  // ── Step 3: Validate pools before interleaving ───────────────────────────
  const REQUIRED_TOTAL = SESSION_SIZE * TOTAL_SESSIONS;
  let poolTotal = 0;
  let poolShort = false;
  for (const [categoryId, targetCount] of Object.entries(EDITORIAL_MIX)) {
    const got = pools[categoryId]?.length ?? 0;
    poolTotal += got;
    if (got < targetCount) {
      console.error(`[generateDaily] POOL SHORT: "${categoryId}" has ${got}/${targetCount} questions`);
      poolShort = true;
    }
  }
  console.log(`[generateDaily] total questions in pools: ${poolTotal} (need ${REQUIRED_TOTAL})`);
  if (poolShort) {
    throw new Error(
      `[generateDaily] Cannot build ${REQUIRED_TOTAL}-question set — one or more category pools are short. ` +
      `Increase FETCH_COUNTS or loosen the hard-news filter.`
    );
  }

  // ── Step 4: Interleave into session order ─────────────────────────────────
  const questions = interleaveIntoSessions(pools);
  if (questions.length !== REQUIRED_TOTAL) {
    throw new Error(
      `[generateDaily] Interleaving produced ${questions.length} questions, expected ${REQUIRED_TOTAL}. ` +
      `Check interleaveIntoSessions logic.`
    );
  }
  console.log(`[generateDaily] ✓ ${questions.length} questions across ${TOTAL_SESSIONS} sessions`);

  // ── Step 5: Persist to Redis + Supabase ───────────────────────────────────
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
