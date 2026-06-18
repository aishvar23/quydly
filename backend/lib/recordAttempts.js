// Shared per-question attempt recorder for both POST /api/complete surfaces
// (backend/routes/complete.js and api/complete.js).
//
// Writes the user's attempted question ids into user_question_attempts — the
// "checkpoint" that serve_unseen excludes. Runs for ALL users, anonymous
// included: a guest's free-5 must be in the ledger BEFORE they sign in so that
// linkIdentity (which preserves the user_id) makes them excluded afterwards.
//
// Resilient to stale/orphaned ids: user_question_attempts.question_id FKs to
// quiz_questions(id), so a single id that is no longer present would make the
// whole multi-row upsert fail and silently drop EVERY attempt in the
// completion. Stale ids are realistic — a day's quiz_questions can be replaced
// by an admin re-generation (cascade-deleting the old rows) while a client
// still holds the previous page, or a non-fatal quiz_questions insert failure
// can leave a daily_questions id with no matching row. So we first narrow to
// ids that actually exist, then upsert only those — known-good attempts are
// always recorded; unknown ids are skipped with a warning.
//
// Idempotent (PK = user_id,question_id + ignoreDuplicates). Non-fatal: the
// completion is already committed by the caller, so a failure is logged.
export async function recordAttempts(supabase, userId, results) {
  const candidates = (results ?? [])
    .filter((r) => r && r.id)                 // tolerate legacy/id-less rows
    .map((r) => ({
      id:      r.id,
      correct: !!r.correct,
      delta:   typeof r.delta === "number" ? r.delta : 0,
    }));

  if (candidates.length === 0) return;

  // Keep only ids that exist in quiz_questions — one missing id would otherwise
  // reject the entire batch via the question_id FK.
  const { data: existing, error: existErr } = await supabase
    .from("quiz_questions")
    .select("id")
    .in("id", candidates.map((c) => c.id));
  if (existErr) {
    console.warn(`[recordAttempts] existence check failed for ${userId}: ${existErr.message}`);
    return;
  }

  const known = new Set((existing ?? []).map((r) => r.id));
  const attempts = candidates
    .filter((c) => known.has(c.id))
    .map((c) => ({ user_id: userId, question_id: c.id, correct: c.correct, delta: c.delta }));

  const dropped = candidates.length - attempts.length;
  if (dropped > 0) {
    console.warn(`[recordAttempts] ${dropped}/${candidates.length} attempt(s) skipped for ${userId}: id not in quiz_questions`);
  }
  if (attempts.length === 0) return;

  const { error } = await supabase
    .from("user_question_attempts")
    .upsert(attempts, { onConflict: "user_id,question_id", ignoreDuplicates: true });

  if (error) console.warn(`[recordAttempts] failed for ${userId}: ${error.message}`);
}
