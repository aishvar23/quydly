import { Router } from "express";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { generateDaily } from "../jobs/generateDaily.js";

const router = Router();

function redisKey(date) {
  return `questions:${date}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildRedis() {
  if (!process.env.REDIS_URL) return null;
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  r.on("error", () => {});
  return r;
}

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/questions?offset=0
router.get("/", async (req, res) => {
  const date = todayDate();
  const redis = buildRedis();
  const supabase = buildSupabase();
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit  = 5;

  try {
    let allQuestions = null;
    let generatedAt  = null;
    let source       = null;

    // 1. Redis cache check
    if (redis) {
      try {
        await redis.connect();
        const cached = await redis.get(redisKey(date));
        if (cached) {
          allQuestions = JSON.parse(cached);
          source = "redis";
        }
      } catch {
        // Redis unavailable — fall through
      } finally {
        redis.disconnect();
      }
    }

    // 2. Supabase fallback
    if (!allQuestions) {
      const { data, error } = await supabase
        .from("daily_questions")
        .select("questions, generated_at")
        .eq("date", date)
        .single();

      if (!error && data) {
        allQuestions = data.questions;
        generatedAt  = data.generated_at;
        source = "supabase";
      }
    }

    // 3. Generate on-demand (shouldn't happen in normal flow)
    if (!allQuestions) {
      console.warn("[GET /api/questions] cache miss — generating on demand");
      allQuestions = await generateDaily();
      generatedAt  = new Date().toISOString();
      source = "generated";
    }

    const questions = allQuestions.slice(offset, offset + limit);
    if (questions.length === 0) {
      return res.status(404).json({ error: "No more questions available for today" });
    }

    return res.json({ date, questions, generatedAt, source, offset, total: allQuestions.length });
  } catch (err) {
    console.error("[GET /api/questions]", err);
    res.status(500).json({ error: "Failed to retrieve questions" });
  }
});

export default router;
