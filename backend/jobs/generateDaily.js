import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, EDITORIAL_MIX, SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";
import { fetchArticlePool, fetchAudienceStoryPools, fetchStoryPool } from "../services/articleStore.js";
import { generateQuestion } from "../services/claude.js";
import { sendDailyNotification } from "../services/email.js";
import FLAGS from "../../config/flags.js";
import { quizDay } from "../lib/quizDay.js";

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
  const date = quizDay();
  // Keep backward-compatible key for global; scope other audiences
  return audience === "global" ? `questions:${date}` : `questions:${date}:${audience}`;
}

// ── Narrative dedup ───────────────────────────────────────────────────────────
// Two stories can describe the same real-world event with different wording.
// We compare the salient vocabulary (proper nouns / content words) of each
// story; a strong overlap means "same narrative" and the slot is retried with
// the next story so the daily set doesn't ask about one event twice.

const DEDUP_STOPWORDS = new Set(
  ("the a an and or of to in on for with at by from as is are was were be been " +
   "being it its this that these those after over amid into out up down new " +
   "news say says said report reports will would can could has have had not " +
   "about more most than then now today").split(" "),
);

function salientTokens(text) {
  const set = new Set();
  for (const tok of String(text ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)) {
    if (tok.length >= 4 && !DEDUP_STOPWORDS.has(tok)) set.add(tok);
  }
  return set;
}

function isDuplicateNarrative(sig, usedSignatures) {
  const MIN_SHARED = 4;   // ignore short headlines sharing one common word
  const THRESHOLD  = 0.5; // ≥50% of the smaller vocabulary in common
  for (const used of usedSignatures) {
    if (sig.size === 0 || used.size === 0) continue;
    const [small, big] = sig.size <= used.size ? [sig, used] : [used, sig];
    let inter = 0;
    for (const t of small) if (big.has(t)) inter++;
    if (inter >= MIN_SHARED && inter / small.size >= THRESHOLD) return true;
  }
  return false;
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

// Durable per-question identity for the signed-in unbounded/multi-day backlog.
// Replace this day's set (admin re-trigger replaces rather than appends);
// user_question_attempts cascades on delete, so a manual re-generation cleanly
// resets that day. Runs for BOTH audiences (quiz_questions has an audience col).
async function saveQuizQuestions(supabase, date, audience, rows) {
  if (rows.length === 0) return;
  const { error: delErr } = await supabase
    .from("quiz_questions")
    .delete()
    .eq("date", date)
    .eq("audience", audience);
  if (delErr) throw new Error(`quiz_questions delete failed: ${delErr.message}`);

  const { error: insErr } = await supabase.from("quiz_questions").insert(rows);
  if (insErr) throw new Error(`quiz_questions insert failed: ${insErr.message}`);
  console.log(`[supabase] saved ${rows.length} quiz_questions for ${date} (${audience})`);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function generateDaily(audience = "global", { silent = false } = {}) {
  console.log(`[generateDaily] starting pipeline (audience="${audience}")`);

  const pipelineStartedAt = Date.now();
  const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;
  const PERSISTENCE_BUFFER_MS = 10 * 1000;
  const generationDeadline = pipelineStartedAt + PIPELINE_TIMEOUT_MS - PERSISTENCE_BUFFER_MS;

  const redis = buildRedisClient();
  const supabase = buildSupabaseClient();
  const categoryQueue = buildCategoryQueue();
  const date = quizDay();   // 7AM-reset quiz day — same key the read path uses
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
  // Bumped 3 → 5 so a slot that keeps drawing same-narrative stories still
  // has room to reach a fresh one (dedup skips cost no Claude call).
  const MAX_SKIP_ATTEMPTS = 5;
  const questions = [];
  const usedSignatures = []; // salient-token sets of stories already used today
  let stoppedForDeadline = false;

  for (const category of categoryQueue) {
    if (Date.now() >= generationDeadline) {
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
      let article, resolvedCategoryId;
      try {
        ({ article, resolvedCategoryId } = pickFromPool(category.id));
      } catch (err) {
        console.error(
          `[generateDaily] pool exhausted for "${category.id}" at question ${questions.length + 1}: ${err.message}`,
        );
        break;
      }

      // Skip same-narrative stories before spending a Claude call on them.
      const sig = salientTokens(`${article.title} ${article.description}`);
      if (isDuplicateNarrative(sig, usedSignatures)) {
        console.warn(`[generateDaily] "${category.id}" story repeats an earlier narrative — trying next`);
        continue;
      }

      try {
        question = await generateQuestion(article, resolvedCategoryId);
      } catch (err) {
        console.error(
          `[generateDaily] generation error (attempt ${attempt + 1}) for "${category.id}": ${err.message}`,
        );
        break;
      }

      if (question) {
        question._storyId = article?._story_id ?? null;  // for quiz_questions.story_id
        usedSignatures.push(sig);
        break;
      }
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
  // Assign a stable id to each question and build the durable quiz_questions
  // rows. MUST run before any caching so the cached/daily_questions jsonb
  // carries the id — that id is what the attempt-tracking path records, which
  // is how a guest's free-5 are excluded once they sign in (same user_id).
  const quizRows = questions.map((q) => {
    const id = randomUUID();
    const storyId = q._storyId ?? null;
    q.id = id;             // embed into the cached object
    delete q._storyId;     // keep the cached jsonb shape clean
    return {
      id,
      date,
      audience,
      category_id:   q.categoryId,
      question:      q.question,
      options:       q.options,
      correct_index: q.correctIndex,
      tldr:          q.tldr,
      story_id:      storyId,
    };
  });

  // Non-fatal: a quiz_questions failure must not block the daily_questions /
  // Redis write the anonymous free-5 path depends on.
  if (quizRows.length > 0) {
    try {
      await saveQuizQuestions(supabase, date, audience, quizRows);
    } catch (err) {
      console.warn(`[generateDaily] quiz_questions persist failed (non-fatal): ${err.message}`);
    }
  }

  // Redis is a best-effort HOT CACHE for today's quiz (fast path on read).
  if (redis && questions.length > 0) {
    try {
      await redis.connect();
      await cacheInRedis(redis, todayKey(audience), questions);
    } catch (err) {
      console.warn("[generateDaily] Redis cache write failed (non-fatal):", err.message);
    } finally {
      redis.disconnect();
    }
  }

  // Supabase daily_questions is the DURABLE SOURCE OF TRUTH that GET /api/questions
  // falls back to when the cache misses (eviction, or the gap before the next
  // cron). It must be written on EVERY successful global run — not only when
  // Redis is down — or the read-side latest-row fallback serves stale/empty.
  // (No audience column: non-global stays Redis-only.)
  if (audience === "global" && questions.length > 0) {
    await saveToSupabase(supabase, date, questions);
  }

  // Notify all subscribed users — only on the scheduled global generation.
  // Skipped for non-global audiences, on-demand cache-miss rebuilds, and
  // silent (manual) runs to prevent spurious duplicate emails.
  if (audience === "global" && !silent) {
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
