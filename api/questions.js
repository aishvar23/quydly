import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { VALID_AUDIENCES } from "../backend/lib/audiences.js";
import { resolveQuestions, normalizeCategory } from "../backend/lib/serveQuestions.js";

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

// GET /api/questions[?audience=india|global][&category=<id>]
// Anonymous → one free 5-question session/day.
// Signed-in → unbounded, multi-day backlog of unseen questions (optional beat).
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawAudience = req.query.audience;
  const audience    = VALID_AUDIENCES.includes(rawAudience) ? rawAudience : "global";
  const category    = normalizeCategory(req.query.category);

  const authHeader = req.headers.authorization ?? "";
  const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  try {
    const body = await resolveQuestions({
      audience,
      category,
      token,
      redis:      buildRedis(),
      supabase:   buildSupabase(),
      anonClient: buildAnonSupabase(),
    });
    return res.json(body);
  } catch (err) {
    console.error("[GET /api/questions]", err.message);
    return res.status(500).json({ error: "Failed to retrieve questions" });
  }
}
