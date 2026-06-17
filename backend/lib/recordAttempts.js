// Shared per-question attempt recorder for both POST /api/complete surfaces
// (backend/routes/complete.js and api/complete.js).
//
// Writes the user's attempted question ids into user_question_attempts — the
// "checkpoint" that serve_unseen excludes. Runs for ALL users, anonymous
// included: a guest's free-5 must be in the ledger BEFORE they sign in so that
// linkIdentity (which preserves the user_id) makes them excluded afterwards.
//
// Idempotent (PK = user_id,question_id + ignoreDuplicates) so re-submitting a
// run never errors and preserves the first attempt. Non-fatal: the completion
// is already committed by the caller, so a ledger write failure is logged, not
// thrown.
export async function recordAttempts(supabase, userId, results) {
  const attempts = (results ?? [])
    .filter((r) => r && r.id)                 // tolerate legacy/id-less rows
    .map((r) => ({
      user_id:     userId,
      question_id: r.id,
      correct:     !!r.correct,
      delta:       typeof r.delta === "number" ? r.delta : 0,
    }));

  if (attempts.length === 0) return;

  const { error } = await supabase
    .from("user_question_attempts")
    .upsert(attempts, { onConflict: "user_id,question_id", ignoreDuplicates: true });

  if (error) console.warn(`[recordAttempts] failed for ${userId}: ${error.message}`);
}
