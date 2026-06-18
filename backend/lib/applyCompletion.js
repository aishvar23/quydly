// Shared completion logic for both POST /api/complete surfaces
// (backend/routes/complete.js, Express local dev; api/complete.js, Vercel prod).
// Both handlers previously inlined this verbatim and are exactly the kind of
// pair that drifts — this is the single source of truth so they can't.
//
// Records the completion, advances the per-question checkpoint, recomputes the
// user's LIFETIME stats from the attempt ledger (the score/accuracy/answered
// display is cumulative and never resets), updates the users row, and returns
// the values the frontend reconciles against.

import { subDays } from "date-fns";
import { recordAttempts } from "./recordAttempts.js";

function updateStreak(user, today) {
  const yesterday = subDays(new Date(today), 1).toISOString().slice(0, 10);
  if (user.last_played === yesterday) return user.streak + 1;
  if (user.last_played === today)     return user.streak;
  return 1;
}

// Recompute lifetime answered/correct from user_question_attempts — the
// authoritative, idempotent ledger — via a single aggregate RPC (one round-trip,
// and the "answered = delta <> 0" rule lives only in SQL, shared with the
// migration backfill). Returns null on ANY error (including the non-throwing
// PostgREST error channel) so the caller skips persisting rather than writing
// bogus zeros over real history.
async function computeLifetimeStats(supabase, userId) {
  const { data, error } = await supabase.rpc("compute_lifetime_stats", { p_user: userId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { totalAnswered: row.answered ?? 0, totalCorrect: row.correct ?? 0 };
}

// Throws Error with `.status` on a recoverable client/server condition so the
// HTTP handlers can map it to the right code; returns the response body on success.
export async function applyCompletion(supabase, { userId, isAnonymous, score, results, today }) {
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("streak, last_played, total_points")
    .eq("id", userId)
    .single();

  if (userErr || !user) {
    const e = new Error("User not found");
    e.status = 404;
    throw e;
  }

  const newStreak   = updateStreak(user, today);
  const totalPoints = user.total_points + score;

  // Advance the per-question checkpoint FIRST (anon included — see recordAttempts).
  // It's the ledger that lifetime stats and serve_unseen exclusion both trust, so
  // a write failure must fail the whole request (500) rather than let the client
  // treat an unrecorded run as saved (which would lose stats and re-serve the
  // just-answered questions). recordAttempts returns false only on a real DB error.
  const recorded = await recordAttempts(supabase, userId, results);
  if (!recorded) {
    const e = new Error("Failed to record attempts");
    e.status = 500;
    throw e;
  }

  const { error: compErr } = await supabase
    .from("completions")
    .upsert({ user_id: userId, date: today, score, results }, { onConflict: "user_id,date" });
  if (compErr) {
    const e = new Error("Failed to record completion");
    e.status = 500;
    throw e;
  }

  // Recompute lifetime stats so the counts reflect this completion's attempts.
  const lifetime = await computeLifetimeStats(supabase, userId);

  const update = { streak: newStreak, last_played: today, total_points: totalPoints };
  if (lifetime) {
    update.total_answered = lifetime.totalAnswered;
    update.total_correct  = lifetime.totalCorrect;
  }

  let { error: updateErr } = await supabase.from("users").update(update).eq("id", userId);
  // Deploy-safe: ONLY if the lifetime columns aren't migrated yet (Postgres
  // undefined_column, 42703) would the update reject and lose streak/points too.
  // Retry without them so completions still commit; the stats self-heal once the
  // migration lands. Any other error (RLS, constraint, transient) must surface,
  // not be silently retried.
  if (updateErr && lifetime && updateErr.code === "42703") {
    delete update.total_answered;
    delete update.total_correct;
    ({ error: updateErr } = await supabase.from("users").update(update).eq("id", userId));
  }
  if (updateErr) {
    const e = new Error("Failed to update user record");
    e.status = 500;
    throw e;
  }

  const { count, error: rankErr } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .gt("total_points", totalPoints);
  const rank = rankErr ? null : (count ?? 0) + 1;

  const promptSaveStreak = isAnonymous && newStreak >= 1;

  // Atomically advance the per-day session counter (anon free-tier backstop +
  // next-batch cursor). Non-fatal — streak/points already saved above.
  const { error: bumpErr } = await supabase.rpc("bump_daily_session", {
    p_user: userId, p_date: today, p_score: totalPoints,
  });
  if (bumpErr) console.warn(`[applyCompletion] session bump failed: ${bumpErr.message}`);

  return {
    streak: newStreak,
    totalPoints,
    totalAnswered: lifetime?.totalAnswered ?? null,
    totalCorrect:  lifetime?.totalCorrect ?? null,
    rank,
    promptSaveStreak,
  };
}
