import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
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
  // 1. Redis daily cache.
  if (redis) {
    try {
      await redis.connect();
      const cached = await redis.get(redisKey(date));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return { questions: parsed, source: "redis" };
        await redis.del(redisKey(date));
      }
    } catch {
      // Redis unavailable — fall through
    } finally {
      redis.disconnect();
    }
  }

  // 2. Today's row. maybeSingle(): a missing row is the expected "cron hasn't
  //    run yet" path, not an error. A real query error is surfaced (throw) so
  //    the handler returns 500 rather than masquerading a DB outage as an
  //    empty/"all caught up" quiz.
  const { data, error } = await supabase
    .from("daily_questions")
    .select("questions, generated_at")
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(`daily_questions lookup failed: ${error.message}`);
  if (data && Array.isArray(data.questions) && data.questions.length > 0) {
    return { questions: data.questions, generatedAt: data.generated_at, source: "supabase" };
  }

  // 3. Latest available row. Today's quiz isn't ready yet — serve the most
  //    recent prior quiz so the user never waits on live generation. We NEVER
  //    generate in the request path; generation runs only from the 7AM cron
  //    (/api/cron/generate) or the manual silent trigger (/api/cron/generate-silent).
  const { data: latest, error: latestErr } = await supabase
    .from("daily_questions")
    .select("questions, generated_at, date")
    .lte("date", date)                       // never serve a future-dated row
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(`daily_questions latest lookup failed: ${latestErr.message}`);
  if (latest && Array.isArray(latest.questions) && latest.questions.length > 0) {
    console.warn(`[GET /api/questions] today's quiz (${date}) missing — serving latest (${latest.date})`);
    return { questions: latest.questions, generatedAt: latest.generated_at, source: "supabase-latest" };
  }

  // 4. Defensive only: reachable solely on a cold start (no quiz ever generated)
  //    or a wiped table. In steady state step 3 always returns a row.
  console.error(`[GET /api/questions] no daily_questions rows at or before ${date}`);
  return { questions: [], generatedAt: null, source: "empty" };
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
