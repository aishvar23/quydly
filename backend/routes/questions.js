import { Router } from "express";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { generateDaily } from "../jobs/generateDaily.js";
import { SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";

const router = Router();

const VALID_AUDIENCES = ["india", "global"];

function redisKey(date, audience = "global") {
  return audience === "global" ? `questions:${date}` : `questions:${date}:${audience}`;
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

function buildAnonSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

async function getAllQuestions(date, audience, redis, supabase) {
  // 1. Redis cache check (audience-scoped key)
  if (redis) {
    try {
      await redis.connect();
      const cached = await redis.get(redisKey(date, audience));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.length > 0) return { questions: parsed, source: "redis" };
        await redis.del(redisKey(date, audience));
      }
    } catch {
      // Redis unavailable — fall through
    } finally {
      redis.disconnect();
    }
  }

  // 2. Supabase fallback — only for global (daily_questions.date is a single PK)
  if (audience === "global") {
    const { data, error } = await supabase
      .from("daily_questions")
      .select("questions, generated_at")
      .eq("date", date)
      .single();

    if (!error && data) {
      return { questions: data.questions, generatedAt: data.generated_at, source: "supabase" };
    }
  }

  // 3. Generate on-demand (cache miss)
  console.warn(`[GET /api/questions] cache miss (audience="${audience}") — generating on demand`);
  const questions = await generateDaily(audience);
  return { questions, generatedAt: new Date().toISOString(), source: "generated" };
}

// GET /api/questions[?audience=india|global]
// No auth  → always serves session 0 (first 5 questions)
// With auth → serves next unplayed session based on user_daily_progress
router.get("/", async (req, res) => {
  const date     = todayDate();
  const redis    = buildRedis();
  const supabase = buildSupabase();

  // 8.1 — audience param: whitelist against known values, default to "global"
  const rawAudience = req.query.audience;
  const audience    = VALID_AUDIENCES.includes(rawAudience) ? rawAudience : "global";

  try {
    const { questions: allQuestions, generatedAt = null, source } = await getAllQuestions(date, audience, redis, supabase);

    // Determine session index from auth token
    const authHeader = req.headers.authorization ?? "";
    const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    let sessionIndex = 0;

    if (token) {
      try {
        const anonClient = buildAnonSupabase();
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
      } catch {
        // Auth lookup failed — fall back to session 0
      }
    }

    if (sessionIndex >= TOTAL_SESSIONS) {
      return res.json({ date, allCaughtUp: true });
    }

    const start     = sessionIndex * SESSION_SIZE;
    const questions = allQuestions.slice(start, start + SESSION_SIZE);

    if (questions.length === 0) {
      return res.json({ date, allCaughtUp: true });
    }

    return res.json({ date, sessionIndex, questions, generatedAt, source });
  } catch (err) {
    console.error("[GET /api/questions]", err);
    res.status(500).json({ error: "Failed to retrieve questions" });
  }
});

export default router;
