// Shared question-serving logic for both HTTP surfaces:
//   - backend/routes/questions.js (Express, local dev)
//   - api/questions.js            (Vercel serverless, prod)
// Both previously duplicated getAllQuestions + the serve branch verbatim and
// had already drifted; this is the single source of truth so they can't again.
//
// Two serving modes:
//   Anonymous / unauth → ONE free 5-question session per day, from the hot
//     jsonb pool (Redis → daily_questions). The jsonb objects now carry an id
//     (embedded by generateDaily) so completions record attempts.
//   Signed-in → UNBOUNDED, multi-day backlog via the serve_unseen RPC: the next
//     page of questions they have not attempted, newest day first, reaching
//     back across days until none remain → { allCaughtUp: true }. Optional
//     single-category (beat) filter.

import { CATEGORIES, SESSION_SIZE } from "../../config/categories.js";
import { quizDay } from "./quizDay.js";

// Page size for the signed-in unbounded run. Each fetched page is one "run":
// the frontend plays it, submits (recording attempts), then "play again"
// fetches the next page excluding what was just attempted.
const SIGNED_IN_PAGE_SIZE = 10;

const VALID_CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

function redisKey(date, audience = "global") {
  return audience === "global" ? `questions:${date}` : `questions:${date}:${audience}`;
}

// quiz_questions row → the shape QuestionScreen consumes.
function mapRow(r) {
  return {
    id:           r.id,
    question:     r.question,
    options:      r.options,
    correctIndex: r.correct_index,
    tldr:         r.tldr,
    categoryId:   r.category_id,
  };
}

// Resolve the hot daily pool for the anonymous fast path:
// Redis → daily_questions (today) → latest row at/before date → empty.
// NEVER generates in the request path (generation runs only from the cron).
export async function getAllQuestions(date, audience, redis, supabase) {
  if (redis) {
    try {
      await redis.connect();
      const cached = await redis.get(redisKey(date, audience));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return { questions: parsed, source: "redis" };
        await redis.del(redisKey(date, audience));
      }
    } catch {
      // Redis unavailable — fall through to Supabase.
    } finally {
      redis.disconnect();
    }
  }

  // daily_questions is global-only (no audience column); non-global falls to the
  // latest-row step below or to the india Redis cache above.
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

  const { data: latest, error: latestErr } = await supabase
    .from("daily_questions")
    .select("questions, generated_at, date")
    .lte("date", date)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(`daily_questions latest lookup failed: ${latestErr.message}`);
  if (latest && Array.isArray(latest.questions) && latest.questions.length > 0) {
    console.warn(`[GET /api/questions] today's quiz (${date}) missing — serving latest (${latest.date})`);
    return { questions: latest.questions, generatedAt: latest.generated_at, source: "supabase-latest" };
  }

  console.error(`[GET /api/questions] no daily_questions rows at or before ${date}`);
  return { questions: [], generatedAt: null, source: "empty" };
}

// Normalize the ?category= param: a known id, else null (= all categories).
export function normalizeCategory(raw) {
  return VALID_CATEGORY_IDS.has(raw) ? raw : null;
}

// Resolve the response body for GET /api/questions. Throws on a real DB error
// (the caller maps that to 500); a missing/empty quiz returns allCaughtUp.
//
// clients: { redis, supabase, anonClient }
export async function resolveQuestions({ audience, category, token, redis, supabase, anonClient }) {
  const date = quizDay();

  // Resolve the caller from the auth token, if any.
  let user = null;
  if (token) {
    try {
      const { data: { user: u }, error: authErr } = await anonClient.auth.getUser(token);
      if (!authErr) user = u;
    } catch {
      // Auth lookup failed — treat as anonymous.
    }
  }
  const isSignedIn = !!user && !(user.is_anonymous ?? false);

  // ── Signed-in: unbounded, multi-day, exclude-attempted ─────────────────────
  if (isSignedIn) {
    const { data, error } = await supabase.rpc("serve_unseen", {
      p_user:     user.id,
      p_audience: audience,
      p_category: category ?? null,
      p_today:    date,
      p_limit:    SIGNED_IN_PAGE_SIZE,
    });
    if (error) throw new Error(`serve_unseen failed: ${error.message}`);

    const rows = data ?? [];
    if (rows.length === 0) {
      // Reached the checkpoint frontier (or empty beat) — caught up.
      return category ? { date, allCaughtUp: true, category } : { date, allCaughtUp: true };
    }
    return { date, questions: rows.map(mapRow), unlimited: true, source: "quiz_questions" };
  }

  // ── Anonymous / unauth: exactly ONE free 5-question session per day ─────────
  const { questions: allQuestions, generatedAt = null, source } =
    await getAllQuestions(date, audience, redis, supabase);

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
      // Progress lookup failed — treat as the first (and only) free session.
    }
  }

  // Free tier is a single session: once they've completed it, they must sign in
  // to continue. (The frontend credit gate prompts sign-in first; this is the
  // server-side backstop.)
  if (sessionIndex >= 1) {
    return { date, allCaughtUp: true };
  }

  const questions = allQuestions.slice(0, SESSION_SIZE);
  if (questions.length === 0) {
    return { date, allCaughtUp: true };
  }
  return { date, sessionIndex, questions, generatedAt, source };
}
