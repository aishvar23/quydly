import { createClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth: extract userId from JWT ───────────────────────────────────────────
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

  const userId      = authUser.id;
  const isAnonymous = authUser.is_anonymous ?? false;

  // ── Validate body ───────────────────────────────────────────────────────────
  const { score, results, date: bodyDate } = req.body ?? {};
  if (score === undefined || !Array.isArray(results)) {
    return res.status(400).json({ error: "Missing required fields: score, results" });
  }

  const supabase = buildSupabase();
  const today    = todayDate();

  // The quiz date the user actually played, echoed from GET /api/questions.
  // On the normal path this is today; in the pre-7AM-cron window it's the prior
  // date served by the latest-row fallback. Completion + session progress key to
  // THIS date (the quiz that was answered) so a stale-fallback play doesn't bump
  // today's counter and skip today's real session 0. Streak keys to real `today`
  // below — the daily ritual is "did the user show up today", not the quiz date.
  // Missing/invalid/future → fall back to today.
  const quizDate =
    typeof bodyDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bodyDate) && bodyDate <= today
      ? bodyDate
      : today;

  try {
    // Fetch current user state
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

    // Upsert completion record (keyed to the played quiz's date)
    const { error: compErr } = await supabase
      .from("completions")
      .upsert({ user_id: userId, date: quizDate, score, results }, { onConflict: "user_id,date" });

    if (compErr) {
      return res.status(500).json({ error: "Failed to record completion" });
    }

    // Update user streak + points
    const { error: updateErr } = await supabase
      .from("users")
      .update({ streak: newStreak, last_played: today, total_points: totalPoints })
      .eq("id", userId);

    if (updateErr) {
      return res.status(500).json({ error: "Failed to update user record" });
    }

    // Global rank: count users with more total_points
    const { count, error: rankErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .gt("total_points", totalPoints);

    const rank = rankErr ? null : (count ?? 0) + 1;

    // promptSaveStreak: true → frontend shows "Save your streak — sign in with Google"
    const promptSaveStreak = isAnonymous && newStreak >= 1;

    // Advance session counter so next GET /api/questions serves the next batch.
    // Non-fatal — streak and points are already committed above.
    if (!isAnonymous) {
      try {
        const { data: progress } = await supabase
          .from("user_daily_progress")
          .select("sessions_completed")
          .eq("user_id", userId)
          .eq("date", quizDate)
          .single();

        const next = (progress?.sessions_completed ?? 0) + 1;
        await supabase
          .from("user_daily_progress")
          .upsert(
            { user_id: userId, date: quizDate, sessions_completed: next, total_score: totalPoints },
            { onConflict: "user_id,date" }
          );
      } catch {
        // Non-fatal
      }
    }

    return res.json({ streak: newStreak, totalPoints, rank, promptSaveStreak });
  } catch (err) {
    console.error("[POST /api/complete]", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
