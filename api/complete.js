import { createClient } from "@supabase/supabase-js";
import { quizDay } from "../backend/lib/quizDay.js";
import { applyCompletion } from "../backend/lib/applyCompletion.js";

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function buildAnonSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
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

  // ── Validate body ───────────────────────────────────────────────────────────
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
    console.error("[POST /api/complete]", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
