import { Router } from "express";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { generateDaily } from "../jobs/generateDaily.js";
import { SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";

const router = Router();

function redisKey(date) {
  return `questions:${date}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildRedis() {
  if (!process.env.REDIS_URL) return null;
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  r.on("error", () => {});
  return r;
}

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getAllQuestions(date, redis, supabase) {
  // 1. Redis cache check
  if (redis) {
    try {
      await redis.connect();
      const cached = await redis.get(redisKey(date));
      if (cached) return { questions: JSON.parse(cached), source: "redis" };
    } catch {
      // Redis unavailable — fall through
    } finally {
      redis.disconnect();
    }
  }

  // 2. Supabase fallback
  const { data, error } = await supabase
    .from("daily_questions")
    .select("questions, generated_at")
    .eq("date", date)
    .single();

  if (!error && data) {
    return { questions: data.questions, generatedAt: data.generated_at, source: "supabase" };
  }

  // 3. Generate on-demand (cache miss — shouldn't happen in normal flow)
  console.warn("[GET /api/questions] cache miss — generating on demand");
  const questions = await generateDaily();
  return { questions, generatedAt: new Date().toISOString(), source: "generated" };
}

// GET /api/questions
// No auth → session 0 (questions 0–4, anonymous)
// Auth    → session based on sessions_completed for today
// Returns { date, sessionIndex, questions, generatedAt, source }
//      or { date, allCaughtUp: true } when all 10 sessions done
router.get("/", async (req, res) => {
  const date = todayDate();
  const redis = buildRedis();
  const supabase = buildSupabase();

  try {
    const { questions, generatedAt = null, source } = await getAllQuestions(date, redis, supabase);

    // Determine session index from auth
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    let sessionIndex = 0;

    if (token) {
      const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);

      if (!authErr && user) {
        const { data: progress } = await supabase
          .from("user_daily_progress")
          .select("sessions_completed")
          .eq("user_id", user.id)
          .eq("date", date)
          .single();

        sessionIndex = progress?.sessions_completed ?? 0;
      }
    }

    if (sessionIndex >= TOTAL_SESSIONS) {
      return res.json({ date, allCaughtUp: true });
    }

    const start = sessionIndex * SESSION_SIZE;
    const sessionQuestions = questions.slice(start, start + SESSION_SIZE);

    return res.json({ date, sessionIndex, questions: sessionQuestions, generatedAt, source });
  } catch (err) {
    console.error("[GET /api/questions]", err);
    res.status(500).json({ error: "Failed to retrieve questions" });
  }
});

export default router;
