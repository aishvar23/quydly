import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";

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
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    { score, results: [{ correct, delta, categoryId }] }
router.post("/", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const anonClient = buildAnonSupabase();
  const { data: { user: authUser }, error: authErr } = await anonClient.auth.getUser(token);

  if (authErr || !authUser) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const userId     = authUser.id;
  const isAnonymous = authUser.is_anonymous ?? false;

  const { score, results } = req.body ?? {};
  if (score === undefined || !Array.isArray(results)) {
    return res.status(400).json({ error: "Missing required fields: score, results" });
  }

  const supabase = buildSupabase();
  const today    = todayDate();

  try {
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("streak, last_played, total_points")
      .eq("id", userId)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newStreak   = updateStreak(user, today);
    const totalPoints = user.total_points + score;

    const { error: compErr } = await supabase
      .from("completions")
      .upsert({ user_id: userId, date: today, score, results }, { onConflict: "user_id,date" });

    if (compErr) {
      return res.status(500).json({ error: "Failed to record completion" });
    }

    const { error: updateErr } = await supabase
      .from("users")
      .update({ streak: newStreak, last_played: today, total_points: totalPoints })
      .eq("id", userId);

    if (updateErr) {
      return res.status(500).json({ error: "Failed to update user record" });
    }

    const { count, error: rankErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .gt("total_points", totalPoints);

    const rank = rankErr ? null : (count ?? 0) + 1;
    const promptSaveStreak = isAnonymous && newStreak >= 1;

    // Advance the user's session counter so the next GET /api/questions
    // serves the next batch. Non-fatal — streak/points already saved above.
    try {
      const { data: progress } = await supabase
        .from("user_daily_progress")
        .select("sessions_completed")
        .eq("user_id", userId)
        .eq("date", today)
        .single();

      const next = (progress?.sessions_completed ?? 0) + 1;
      await supabase
        .from("user_daily_progress")
        .upsert({ user_id: userId, date: today, sessions_completed: next, total_score: totalPoints }, { onConflict: "user_id,date" });
    } catch {
      // Non-fatal — "play more" will just re-serve the same session
    }

    return res.json({ streak: newStreak, totalPoints, rank, promptSaveStreak });
  } catch (err) {
    console.error("[POST /api/complete]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
