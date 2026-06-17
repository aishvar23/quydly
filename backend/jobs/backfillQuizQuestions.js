// One-off backfill: seed quiz_questions from existing daily_questions rows.
//
// Why: the signed-in unbounded/multi-day path serves from quiz_questions (via
// the serve_unseen RPC). Rows generated BEFORE the question-identity migration
// live only as id-less jsonb in daily_questions, so without this a signed-in
// user sees "all caught up" until the next generation run. This walks the most
// recent N quiz-days of daily_questions and inserts each jsonb question into
// quiz_questions with a fresh uuid, so the backlog feels real on day one.
//
// Safe to re-run: skips any date that already has quiz_questions rows (global),
// so it never duplicates and never touches days generateDaily already wrote.
// Only backfills audience='global' (daily_questions is global-only).
//
// Usage:  node backend/jobs/backfillQuizQuestions.js [days=7]

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const AUDIENCE = "global";

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export async function backfillQuizQuestions(days = 7) {
  const supabase = buildSupabase();

  const { data: rows, error } = await supabase
    .from("daily_questions")
    .select("date, questions")
    .order("date", { ascending: false })
    .limit(days);
  if (error) throw new Error(`daily_questions read failed: ${error.message}`);

  let inserted = 0;
  for (const row of rows ?? []) {
    if (!Array.isArray(row.questions) || row.questions.length === 0) continue;

    // Skip dates already represented in quiz_questions (re-run / post-migration).
    const { count, error: cntErr } = await supabase
      .from("quiz_questions")
      .select("id", { count: "exact", head: true })
      .eq("date", row.date)
      .eq("audience", AUDIENCE);
    if (cntErr) throw new Error(`quiz_questions count failed (${row.date}): ${cntErr.message}`);
    if ((count ?? 0) > 0) {
      console.log(`[backfill] ${row.date}: already has ${count} rows — skipping`);
      continue;
    }

    const toInsert = row.questions
      .filter((q) => q && q.question && Array.isArray(q.options))
      .map((q) => ({
        id:            randomUUID(),
        date:          row.date,
        audience:      AUDIENCE,
        category_id:   q.categoryId ?? "world",
        question:      q.question,
        options:       q.options,
        correct_index: q.correctIndex ?? 0,
        tldr:          q.tldr ?? "",
        story_id:      null,                  // identity never existed for old rows
      }));

    if (toInsert.length === 0) continue;

    const { error: insErr } = await supabase.from("quiz_questions").insert(toInsert);
    if (insErr) throw new Error(`quiz_questions insert failed (${row.date}): ${insErr.message}`);
    inserted += toInsert.length;
    console.log(`[backfill] ${row.date}: inserted ${toInsert.length} questions`);
  }

  console.log(`[backfill] done — ${inserted} questions seeded across ${rows?.length ?? 0} day(s)`);
  return inserted;
}

if (process.argv[1] === __filename) {
  const days = Number(process.argv[2]) || 7;
  backfillQuizQuestions(days).catch((err) => {
    console.error("[backfill] fatal:", err.message);
    process.exit(1);
  });
}
