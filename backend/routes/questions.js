import { Router } from "express";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { SESSION_SIZE, TOTAL_SESSIONS } from "../../config/categories.js";
import { VALID_AUDIENCES } from "../lib/audiences.js";
import { quizDay } from "../lib/quizDay.js";

const router = Router();

function redisKey(date, audience = "global") {
  return audience === "global" ? `questions:${date}` : `questions:${date}:${audience}`;
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

  // 2. Supabase — today's row (global only; daily_questions.date is a single PK).
  //    maybeSingle(): a missing row is the expected "cron hasn't run yet" path,
  //    not an error.
  if (audience === "global") {
    const { data, error } = await supabase
      .from("daily_questions")
      .select("questions, generated_at")
      .eq("date", date)
      .maybeSingle();
    if (error) throw new Error(`daily_questions lookup failed: ${error.message}`);
    if (data && Array.isArray(data.questions) && data.questions.length > 0) {
      return { questions: data.questions, generatedAt: data.generated_at, source: "supabase" };
    }
  }

  // 3. Latest available row. Today's quiz isn't ready yet (cron not run, or a
  //    non-global audience with no cache) — serve the most recent prior quiz so
  //    the user never waits on live generation. We NEVER generate in the request
  //    path; generation runs only from the 7AM cron (or the admin trigger).
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

// GET /api/questions[?audience=india|global]
// No auth  → always serves session 0 (first 5 questions)
// With auth → serves next unplayed session based on user_daily_progress
router.get("/", async (req, res) => {
  const date     = quizDay();
  const redis    = buildRedis();
  const supabase = buildSupabase();

  // 8.1 — audience param: whitelist against known values, default to "global"
  const rawAudience = req.query.audience;
  const audience    = VALID_AUDIENCES.includes(rawAudience) ? rawAudience : "global";

  try {
    const { questions: allQuestions, generatedAt = null, source } = await getAllQuestions(date, audience, redis, supabase);

    // Resolve the caller from the auth token (if any)
    const authHeader = req.headers.authorization ?? "";
    const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    let user = null;
    if (token) {
      try {
        const anonClient = buildAnonSupabase();
        const { data: { user: u }, error: authErr } = await anonClient.auth.getUser(token);
        if (!authErr) user = u;
      } catch {
        // Auth lookup failed — treat as anonymous (session 0)
      }
    }

    const isSignedIn = !!user && !(user.is_anonymous ?? false);

    // Signed-in users get unlimited play: serve the entire daily pool in one
    // continuous run. They can quit anytime via POST /api/complete.
    if (isSignedIn) {
      if (allQuestions.length === 0) {
        return res.json({ date, allCaughtUp: true });
      }
      return res.json({ date, questions: allQuestions, unlimited: true, generatedAt, source });
    }

    // Anonymous / unauthenticated: keep the 5-question daily session model.
    let sessionIndex = 0;
    if (user) {
      try {
        const { data: progress } = await supabase
          .from("user_daily_progress")
          .select("sessions_completed")
          .eq("user_id", user.id)
          .eq("date", date)
          .single();
        sessionIndex = progress?.sessions_completed ?? 0;
      } catch {
        // Progress lookup failed — fall back to session 0
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/questions/:id
// Serves a single shareable question (the one tweeted to X) by its social_questions
// uuid. Powers the quydly.com/question/<id> single-question page. Returns the same
// question shape QuestionScreen consumes ({ question, options, correctIndex, tldr,
// categoryId }) so the page can reuse the existing quiz UI.
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid question id" });
  }

  try {
    const supabase = buildSupabase();
    const { data, error } = await supabase
      .from("social_questions")
      .select("id, question, options, correct_index, tldr, category_id")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Question not found" });
    }

    return res.json({
      id:           data.id,
      question:     data.question,
      options:      data.options,
      correctIndex: data.correct_index,
      tldr:         data.tldr,
      categoryId:   data.category_id,
    });
  } catch (err) {
    console.error("[GET /api/questions/:id]", err);
    res.status(500).json({ error: "Failed to retrieve question" });
  }
});

export default router;
