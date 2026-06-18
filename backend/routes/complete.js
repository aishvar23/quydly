import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { quizDay } from "../lib/quizDay.js";
import { applyCompletion } from "../lib/applyCompletion.js";

const router = Router();

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function buildAnonSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// POST /api/complete
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    { score, results: [{ id, correct, delta, categoryId }] }
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

  const { score, results } = req.body ?? {};
  if (score === undefined || !Array.isArray(results)) {
    return res.status(400).json({ error: "Missing required fields: score, results" });
  }

  const supabase = buildSupabase();
  const today    = quizDay();   // 7AM-reset quiz day — matches the served quiz + cron

  try {
    const body = await applyCompletion(supabase, {
      userId:      authUser.id,
      isAnonymous: authUser.is_anonymous ?? false,
      score,
      results,
      today,
    });
    return res.json(body);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[POST /api/complete]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
