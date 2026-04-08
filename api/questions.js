import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { generateDaily } from "../backend/jobs/generateDaily.js";
import { SESSION_SIZE, TOTAL_SESSIONS } from "../config/categories.js";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function redisKey(date) {
  return `questions:${date}`;
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

async function getAllQuestions(date, redis, supabase) {
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

  const { data, error } = await supabase
    .from("daily_questions")
    .select("questions, generated_at")
    .eq("date", date)
    .single();

  if (!error && data) {
    return { questions: data.questions, generatedAt: data.generated_at, source: "supabase" };
  }

  console.warn("[GET /api/questions] cache miss — generating on demand");
  const questions = await generateDaily();
  return { questions, generatedAt: new Date().toISOString(), source: "generated" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const date     = todayDate();
  const redis    = buildRedis();
  const supabase = buildSupabase();

  try {
    const { questions: allQuestions, generatedAt = null, source } = await getAllQuestions(date, redis, supabase);

    // Determine which session to serve from the auth token.
    // No token (anonymous) → always session 0.
    const authHeader = req.headers.authorization ?? "";
    const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    let sessionIndex = 0;

    if (token) {
      try {
        const { data: { user }, error: authErr } = await buildAnonSupabase().auth.getUser(token);
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
    console.error("[GET /api/questions]", err.message);
    return res.status(500).json({ error: "Failed to retrieve questions" });
  }
}
