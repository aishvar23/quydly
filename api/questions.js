import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { generateDaily } from "../backend/jobs/generateDaily.js";

function todayDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function redisKey(date) {
  return `questions:${date}`;
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const date     = todayDate();
  const redis    = buildRedis();
  const supabase = buildSupabase();

  try {
    // 1. Redis cache check
    if (redis) {
      try {
        await redis.connect();
        const cached = await redis.get(redisKey(date));
        if (cached) {
          return res.json({ date, questions: JSON.parse(cached), generatedAt: null, source: "redis" });
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
        questions:   data.questions,
        generatedAt: data.generated_at,
        source:      "supabase",
      });
    }

    // 3. Generate on-demand (cache miss — shouldn't happen in normal flow)
    console.warn("[GET /api/questions] cache miss — generating on demand");
    const questions = await generateDaily();
    return res.json({ date, questions, generatedAt: new Date().toISOString(), source: "generated" });
  } catch (err) {
    console.error("[GET /api/questions]", err.message);
    return res.status(500).json({ error: "Failed to retrieve questions" });
  }
}
