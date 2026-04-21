import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, EDITORIAL_MIX, SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";
import { fetchArticlePool, fetchAudienceStoryPools, fetchStoryPool } from "../services/articleStore.js";
import { generateQuestion } from "../services/claude.js";
import { sendDailyNotification } from "../services/email.js";
import FLAGS from "../../config/flags.js";

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

function todayKey(audience = "global") {
  const date = new Date().toISOString().slice(0, 10);
  // Keep backward-compatible key for global; scope other audiences
  return audience === "global" ? `questions:${date}` : `questions:${date}:${audience}`;
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

export async function generateDaily(audience = "global") {
  console.log(`[generateDaily] starting pipeline (audience="${audience}")`);

  const pipelineStartedAt = Date.now();
  const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;
  const PERSISTENCE_BUFFER_MS = 10 * 1000;
  const generationDeadline = pipelineStartedAt + PIPELINE_TIMEOUT_MS - PERSISTENCE_BUFFER_MS;

  const redis = buildRedisClient();
  const supabase = buildSupabaseClient();
  const categoryQueue = buildCategoryQueue();
  const date = new Date().toISOString().slice(0, 10);
  const totalQuestions = categoryQueue.length;

  // ── Build picker function ─────────────────────────────────────────────────
  // For India (or any non-global audience), try geo-weighted story pools first.
  // Falls back to raw article pools if story_audiences has insufficient rows.
  let pickFromPool;

  if (audience !== "global" && FLAGS.audienceFeedMix.enabled) {
    try {
      const { poolA, poolB, poolC, totalAvailable } =
        await fetchAudienceStoryPools(audience, supabase, totalQuestions, FLAGS.audienceFeedMix);

      if (totalAvailable >= FLAGS.audienceFeedMix.minRowsForAudienceFeed) {
        const heroTarget       = Math.ceil(totalQuestions * FLAGS.audienceFeedMix[audience].heroBuckets);
        const globalIndiaTarget = Math.ceil(totalQuestions * FLAGS.audienceFeedMix[audience].globalSigIndia);

        // Interleave pools in mix order so category-aware picker sees the right distribution
        const geoStories = [
          ...poolA.slice(0, heroTarget),
          ...poolB.slice(0, globalIndiaTarget),
          ...poolC,
        ];

        // Index stories by category for preferred-category picking
        const byCat     = {};
        const byCatIdx  = {};
        for (const s of geoStories) {
          (byCat[s.category_id] = byCat[s.category_id] ?? []).push(s);
        }
        for (const catId of Object.keys(byCat)) byCatIdx[catId] = 0;

        pickFromPool = function pickGeoStory(preferredCategoryId) {
          const pool = byCat[preferredCategoryId];
          const idx  = byCatIdx[preferredCategoryId] ?? 0;
          if (pool && idx < pool.length) {
            byCatIdx[preferredCategoryId]++;
            return { article: pool[idx], resolvedCategoryId: preferredCategoryId };
          }
          for (const [catId, catPool] of Object.entries(byCat)) {
            const fbIdx = byCatIdx[catId] ?? 0;
            if (fbIdx < catPool.length) {
              console.warn(`[generateDaily] geo pool "${preferredCategoryId}" empty — using "${catId}"`);
              byCatIdx[catId]++;
              return { article: catPool[fbIdx], resolvedCategoryId: catId };
            }
          }
          throw new Error(`Geo story pool exhausted for audience "${audience}"`);
        };

        console.log(`[generateDaily] geo pools: A=${poolA.length} B=${poolB.length} C=${poolC.length}`);
      } else {
        console.warn(
          `[generateDaily] only ${totalAvailable} story_audiences rows for "${audience}" ` +
          `(min ${FLAGS.audienceFeedMix.minRowsForAudienceFeed}) — falling back to raw articles`
        );
      }
    } catch (err) {
      console.warn(`[generateDaily] geo pool fetch failed: ${err.message} — falling back to raw articles`);
    }
  }

  // Raw article pool fallback (also the default for audience="global")
  if (!pickFromPool) {
    const articlePools = {};
    const poolIndexes  = {};
    for (const cat of CATEGORIES) {
      const neededSlots = (EDITORIAL_MIX[cat.id] ?? 1) * TOTAL_SESSIONS;
      const stories = await fetchStoryPool(cat.id, neededSlots);

      if (stories.length >= neededSlots) {
        articlePools[cat.id] = stories;
        poolIndexes[cat.id]  = 0;
        console.log(`[generateDaily] fetched ${stories.length} stories for "${cat.id}"`);
      } else if (stories.length > 0) {
        // Pad partial story pool with raw articles so the category never exhausts early
        let padded = stories;
        try {
          const rawArticles = await fetchArticlePool(cat.id);
          padded = [...stories, ...rawArticles];
          console.log(`[generateDaily] "${cat.id}": ${stories.length} stories + ${rawArticles.length} raw articles (needed ${neededSlots})`);
        } catch (err) {
          console.warn(`[generateDaily] raw article pad failed for "${cat.id}": ${err.message} — using ${stories.length} stories only`);
        }
        articlePools[cat.id] = padded;
        poolIndexes[cat.id]  = 0;
      } else {
        try {
          articlePools[cat.id] = await fetchArticlePool(cat.id);
          poolIndexes[cat.id]  = 0;
          console.log(`[generateDaily] story pool empty for "${cat.id}" — using ${articlePools[cat.id].length} raw articles`);
        } catch (err) {
          console.warn(`[generateDaily] no content for "${cat.id}": ${err.message}`);
          articlePools[cat.id] = [];
          poolIndexes[cat.id]  = 0;
        }
      }
    }

    pickFromPool = function pickArticle(preferredCategoryId) {
      const pool = articlePools[preferredCategoryId];
      const idx  = poolIndexes[preferredCategoryId];
      if (pool.length > 0 && idx < pool.length) {
        poolIndexes[preferredCategoryId]++;
        return { article: pool[idx], resolvedCategoryId: preferredCategoryId };
      }
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
    };
  }

  // ── Generation loop ───────────────────────────────────────────────────────
  // Each slot tries up to MAX_SKIP_ATTEMPTS stories before giving up.
  // generateQuestion returns null when a story is skipped (no central fact or
  // critique rejection); the next story in the pool is tried automatically.
  const MAX_SKIP_ATTEMPTS = 3;
  const questions = [];
  let stoppedForDeadline = false;
  const isPastGenerationDeadline = () => Date.now() >= generationDeadline;

  generationLoop:
  for (const category of categoryQueue) {
    if (isPastGenerationDeadline()) {
      stoppedForDeadline = true;
      console.warn(
        `[generateDaily] nearing ${PIPELINE_TIMEOUT_MS / 1000}s timeout; stopping generation ` +
        `${PERSISTENCE_BUFFER_MS / 1000}s early to persist ${questions.length} questions`,
      );
      break;
    }

    console.log(`[generateDaily] generating for category "${category.id}"`);
    let question = null;

    for (let attempt = 0; attempt < MAX_SKIP_ATTEMPTS; attempt++) {
      if (isPastGenerationDeadline()) {
        stoppedForDeadline = true;
        console.warn(
          `[generateDaily] deadline reached mid-category "${category.id}" (attempt ${attempt + 1}); ` +
          `stopping with ${questions.length} questions to preserve persistence window`,
        );
        break generationLoop;
      }

      let article, resolvedCategoryId;
      try {
        ({ article, resolvedCategoryId } = pickFromPool(category.id));
      } catch (err) {
        console.error(
          `[generateDaily] pool exhausted for "${category.id}" at question ${questions.length + 1}: ${err.message}`,
        );
        break;
      }

      try {
        question = await generateQuestion(article, resolvedCategoryId);
      } catch (err) {
        console.error(
          `[generateDaily] generation error (attempt ${attempt + 1}) for "${category.id}": ${err.message}`,
        );
        break;
      }

      if (question) break;
      console.warn(`[generateDaily] story skipped (attempt ${attempt + 1}) for "${category.id}" — trying next`);
    }

    if (question) {
      questions.push(question);
    } else {
      console.warn(`[generateDaily] no acceptable question for "${category.id}" — skipping category`);
      continue;
    }
  }

  console.log(
    `[generateDaily] generated ${questions.length} questions` +
    (stoppedForDeadline ? " (best-effort cutoff reached)" : ""),
  );

  // ── Persist ───────────────────────────────────────────────────────────────
  let redisOk = false;
  if (redis && questions.length > 0) {
    try {
      await redis.connect();
      await cacheInRedis(redis, todayKey(audience), questions);
      redisOk = true;
    } catch (err) {
      console.warn("[generateDaily] Redis unavailable, falling back to Supabase:", err.message);
    } finally {
      redis.disconnect();
    }
  }

  // Supabase fallback: only for global (daily_questions.date is the PK — no audience column)
  if (!redisOk && audience === "global" && questions.length > 0) {
    await saveToSupabase(supabase, date, questions);
  }

  // Notify all subscribed users — only on the scheduled global generation.
  // Skipped for non-global audiences and on-demand cache-miss rebuilds to
  // prevent spurious duplicate emails on Redis eviction or audience misses.
  if (audience === "global") {
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
