import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";
import { fetchAllHeadlines } from "../services/newsdata.js";
import { fetchNewsApiHeadlines } from "../services/newsapi.js";
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
 * Pre-LLM quality gate — mirrors the LLM's own rejection criteria.
 * Returns true if the article has enough substance to generate a directed question:
 *   - Minimum enrichedContext length (200 chars)
 *   - At least one quantitative data point (number, %, $, unit)
 *   - At least two proper nouns (capitalized mid-sentence words)
 *
 * Articles that fail here are skipped before any Claude API call is made.
 */
function hasEnoughSubstance(article) {
  const text = `${article.title} ${article.enrichedContext}`;

  // Must have at least some content
  if (text.length < 100) return false;

  // Must contain at least one number or named entity (capitalized word)
  const hasNumbers = /\d/.test(text);
  const hasNamedEntity = /[A-Z][a-z]{2,}/.test(text);

  return hasNumbers || hasNamedEntity;
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

  // ── Step 1: Fetch articles from both sources ──────────────────────────────
  console.log("[generateDaily] fetching articles from NewsData + NewsAPI...");
  const [newsdataArticles, newsapiArticles] = await Promise.all([
    fetchAllHeadlines(130),
    fetchNewsApiHeadlines(100),
  ]);
  const rawArticles = [...newsdataArticles, ...newsapiArticles];
  console.log(
    `[generateDaily] fetched ${rawArticles.length} articles ` +
    `(newsdata=${newsdataArticles.length}, newsapi=${newsapiArticles.length})`
  );

  // ── Step 2: Score and rank all articles ──────────────────────────────────
  const ranked = rankArticles(rawArticles);
  console.log(
    `[generateDaily] scored ${ranked.length} articles — ` +
    `signal score range: ${ranked.at(-1)?.signalScore ?? 0}–${ranked[0]?.signalScore ?? 0}`
  );

  // ── Step 3: Enrich all ranked articles ───────────────────────────────────
  const enrichedArticles = await enrichArticles(ranked);

  // ── Step 4: Generate questions, iterating best-first until 50 accepted ────
  console.log("[generateDaily] generating questions (hard-news filter active)...");
  const questions = [];

  let prefilterDropped = 0;

  for (const article of enrichedArticles) {
    if (questions.length >= REQUIRED_TOTAL) break;

    if (!hasEnoughSubstance(article)) {
      prefilterDropped++;
      console.log(`[generateDaily] pre-filter drop — insufficient substance: ${article.title.slice(0, 60)}`);
      continue;
    }

    const categoryId = resolveCategoryId(article.categories);
    const label = categoryLabel[categoryId] ?? "News";

    const question = await generateQuestion(
      {
        title: article.title,
        description: article.description ?? null,
        enrichedContext: article.enrichedContext,
        signalScore: article.signalScore,
      },
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

  console.log(
    `[generateDaily] ${questions.length} questions generated from ${enrichedArticles.length} enriched articles ` +
    `(${prefilterDropped} dropped by pre-filter)`
  );

  if (questions.length < REQUIRED_TOTAL) {
    console.warn(
      `[generateDaily] Only ${questions.length}/${REQUIRED_TOTAL} questions generated — ` +
      `proceeding with what we have.`
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
