import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";
import { TOTAL_SESSIONS } from "../../config/categories.js";

const router = Router();

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function buildAnonSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function updateStreak(user, today) {
  const yesterday = subDays(new Date(today), 1).toISOString().slice(0, 10);
  if (user.last_played === yesterday) return user.streak + 1;
  if (user.last_played === today)     return user.streak;
  return 1;
}

// POST /api/complete
// Auth is optional — anonymous users (no token) record session 0 only.
// Body: { score, results: [{ correct, delta, categoryId }] }
router.post("/", async (req, res) => {
  const { score, results } = req.body ?? {};
  if (score === undefined || !Array.isArray(results)) {
    return res.status(400).json({ error: "Missing required fields: score, results" });
  }

  const today = todayDate();
  const supabase = buildSupabase();

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // ── Anonymous path (session 0 only) ─────────────────────────────────────────
  if (!token) {
    await supabase.from("completions").insert({
      user_id: null,
      date: today,
      session_index: 0,
      score,
      results,
    });
    return res.json({ sessionIndex: 0, score, allCaughtUp: false });
  }

  // ── Authenticated path ───────────────────────────────────────────────────────
  const anonClient = buildAnonSupabase();
  const { data: { user: authUser }, error: authErr } = await anonClient.auth.getUser(token);

  if (authErr || !authUser) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const userId = authUser.id;

  try {
    // Current daily progress
    const { data: progress } = await supabase
      .from("user_daily_progress")
      .select("sessions_completed, total_score")
      .eq("user_id", userId)
      .eq("date", today)
      .single();

    const sessionsCompleted = progress?.sessions_completed ?? 0;
    const prevTotalScore   = progress?.total_score ?? 0;

    if (sessionsCompleted >= TOTAL_SESSIONS) {
      return res.json({ allCaughtUp: true });
    }

    const sessionIndex         = sessionsCompleted;
    const newTotalScore        = prevTotalScore + score;
    const newSessionsCompleted = sessionsCompleted + 1;

    // Update daily progress FIRST — this is the critical gate for session advancement.
    // Must succeed before anything else so that play-more always gets the next session.
    const { error: progressErr } = await supabase.from("user_daily_progress").upsert(
      { user_id: userId, date: today, sessions_completed: newSessionsCompleted, total_score: newTotalScore },
      { onConflict: "user_id,date" }
    );
    if (progressErr) return res.status(500).json({ error: "Failed to update progress" });

    // Record session details — non-critical for session advancement (analytics only).
    const { error: compErr } = await supabase.from("completions").upsert(
      { user_id: userId, date: today, session_index: sessionIndex, score, results },
      { onConflict: "user_id,date,session_index" }
    );
    if (compErr) {
      console.error(`[POST /api/complete] completions upsert failed (non-fatal):`, compErr.message);
    }

    // Update streak + lifetime points. Use upsert so new users (where the DB
    // trigger hasn't fired yet) are created rather than silently dropped.
    const { data: user } = await supabase
      .from("users")
      .select("streak, last_played, total_points")
      .eq("id", userId)
      .single();

    const newStreak      = user ? updateStreak(user, today) : 1;
    const lifetimePoints = (user?.total_points ?? 0) + score;

    await supabase
      .from("users")
      .upsert(
        { id: userId, streak: newStreak, last_played: today, total_points: lifetimePoints },
        { onConflict: "id" }
      );

    // Global rank by lifetime points
    const { count, error: rankErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .gt("total_points", lifetimePoints);

    const rank        = rankErr ? null : (count ?? 0) + 1;
    const allCaughtUp = newSessionsCompleted >= TOTAL_SESSIONS;

    return res.json({
      sessionIndex,
      sessionsCompleted: newSessionsCompleted,
      score,
      totalScore: newTotalScore,
      streak: newStreak,
      totalPoints: lifetimePoints,
      rank,
      allCaughtUp,
    });
  } catch (err) {
    console.error("[POST /api/complete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
