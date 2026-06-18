import { Router } from "express";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { VALID_AUDIENCES } from "../lib/audiences.js";
import { resolveQuestions, normalizeCategory } from "../lib/serveQuestions.js";

const router = Router();

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
router.get("/", async (req, res) => {
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
    console.error("[GET /api/questions]", err);
    res.status(500).json({ error: "Failed to retrieve questions" });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/questions/:id
// Serves a single shareable question (the one tweeted to X) by its social_questions
// uuid. Powers the quydly.com/question/<id> single-question page. Returns the same
// question shape QuestionScreen consumes ({ question, options, correctIndex, tldr,
// categoryId }) so the page can reuse the existing quiz UI.
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid question id" });
  }

  try {
    const supabase = buildSupabase();
    const { data, error } = await supabase
      .from("social_questions")
      .select("id, question, options, correct_index, tldr, category_id")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Question not found" });
    }

    return res.json({
      id:           data.id,
      question:     data.question,
      options:      data.options,
      correctIndex: data.correct_index,
      tldr:         data.tldr,
      categoryId:   data.category_id,
    });
  } catch (err) {
    console.error("[GET /api/questions/:id]", err);
    res.status(500).json({ error: "Failed to retrieve question" });
  }
});

export default router;
