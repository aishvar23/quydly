import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";
import { fetchAllHeadlines } from "../services/newsdata.js";
import { rankArticles } from "../services/scorer.js";
import { enrichArticles } from "../services/enricher.js";
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

const KNOWN_CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

/**
 * Return the first NewsData category that matches one of our internal IDs.
 * Falls back to "world" if nothing matches.
 */
function resolveCategoryId(categories) {
  return (Array.isArray(categories) ? categories : []).find((c) => KNOWN_CATEGORY_IDS.has(c)) ?? "world";
}

/**
 * Chunk a flat array into groups of `size`.
 */
function chunkIntoSessions(questions, size) {
  const sessions = [];
  for (let i = 0; i < questions.length; i += size) {
    sessions.push(questions.slice(i, i + size));
  }
  return sessions;
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

  const REQUIRED_TOTAL = SESSION_SIZE * TOTAL_SESSIONS; // 50

  // Build label lookup: categoryId → label
  const categoryLabel = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

  // ── Step 1: Fetch 100 raw articles ────────────────────────────────────────
  console.log("[generateDaily] fetching 130 articles...");
  const rawArticles = await fetchAllHeadlines(130);
  console.log(`[generateDaily] fetched ${rawArticles.length} articles`);

  // ── Step 2: Score and rank all 100 articles ───────────────────────────────
  const ranked = rankArticles(rawArticles);
  const SCRAPE_POOL = 80;
  const top80 = ranked.slice(0, SCRAPE_POOL);
  console.log(
    `[generateDaily] scored ${ranked.length} articles — ` +
    `selecting top ${top80.length} by signal score for scraping`
  );
  console.log(
    `[generateDaily] signal score range: ${top80.at(-1)?.signalScore ?? 0}–${top80[0]?.signalScore ?? 0}`
  );

  // ── Step 3: Enrich top 80 — scrape full article bodies ────────────────────
  // Provides a 30-article buffer: scraper → 80, LLM accepts → 50
  const enrichedArticles = await enrichArticles(top80);

  // ── Step 4: Generate questions, iterating best-first until 50 accepted ────
  console.log("[generateDaily] generating questions (hard-news filter active)...");
  const questions = [];

  for (const article of enrichedArticles) {
    if (questions.length >= REQUIRED_TOTAL) break;

    const categoryId = resolveCategoryId(article.categories);
    const label = categoryLabel[categoryId] ?? "News";

    const question = await generateQuestion(
      { title: article.title, enrichedContext: article.enrichedContext, signalScore: article.signalScore },
      categoryId,
      label
    );

    if (question !== null) {
      questions.push(question);
      console.log(
        `[generateDaily] accepted ${questions.length}/${REQUIRED_TOTAL} ` +
        `[${categoryId}, signal=${article.signalScore}, lowDetail=${article.isLowDetail}] ` +
        `${article.title.slice(0, 55)}`
      );
    }
  }

  console.log(`[generateDaily] ${questions.length} questions generated from ${enrichedArticles.length} enriched articles`);

  if (questions.length < REQUIRED_TOTAL) {
    throw new Error(
      `[generateDaily] Only ${questions.length}/${REQUIRED_TOTAL} questions generated. ` +
      `Consider fetching more than 100 articles or adjusting the signal threshold.`
    );
  }

  // ── Step 5: Log category distribution ─────────────────────────────────────
  const dist = {};
  for (const q of questions) dist[q.categoryId] = (dist[q.categoryId] ?? 0) + 1;
  console.log("[generateDaily] category distribution:", dist);

  // ── Step 6: Chunk into sessions (signal-score order → best questions first) ─
  const sessions = chunkIntoSessions(questions, SESSION_SIZE);
  console.log(`[generateDaily] ✓ ${questions.length} questions across ${sessions.length} sessions`);

  // ── Step 7: Persist to Redis + Supabase ───────────────────────────────────
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
