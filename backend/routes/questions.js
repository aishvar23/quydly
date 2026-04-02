const { Router } = require("express");
const Redis = require("ioredis");
const { createClient } = require("@supabase/supabase-js");
const { generateDaily } = require("../jobs/generateDaily");

const router = Router();

function redisKey(date) {
  return `questions:${date}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function buildRedis() {
  if (!process.env.REDIS_URL) return null;
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  r.on("error", () => {}); // suppress unhandled error events
  return r;
}

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/questions
router.get("/", async (req, res) => {
  const date = todayDate();
  const redis = buildRedis();
  const supabase = buildSupabase();

  try {
    // 1. Redis cache check
    if (redis) {
      try {
        await redis.connect();
        const cached = await redis.get(redisKey(date));
        if (cached) {
          const questions = JSON.parse(cached);
          return res.json({ date, questions, generatedAt: null, source: "redis" });
        }
      } catch {
        // Redis unavailable — fall through
      } finally {
        redis.disconnect();
      }
    }

    // 2. Supabase fallback
    const { data, error } = await supabase
      .from("daily_questions")
      .select("questions, generated_at")
      .eq("date", date)
      .single();

    if (!error && data) {
      return res.json({
        date,
        questions: data.questions,
        generatedAt: data.generated_at,
        source: "supabase",
      });
    }

    // 3. Generate on-demand (shouldn't happen in normal flow)
    console.warn("[GET /api/questions] cache miss — generating on demand");
    const questions = await generateDaily();
    return res.json({ date, questions, generatedAt: new Date().toISOString(), source: "generated" });
  } catch (err) {
    console.error("[GET /api/questions]", err);
    res.status(500).json({ error: "Failed to retrieve questions" });
  }
});

module.exports = router;
