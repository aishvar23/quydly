import { createClient } from "@supabase/supabase-js";

// GET /api/questions/:id
// Serves a single shareable question (the one tweeted to X) by its
// social_questions uuid. Powers the quydly.com/question/<id> page. Returns the
// same shape QuestionScreen consumes ({ question, options, correctIndex, tldr,
// categoryId }) so the page reuses the existing quiz card.
//
// NOTE: This is the production (Vercel function) twin of the local Express route
// in backend/routes/questions.js — keep the two in sync.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id || !UUID_RE.test(id)) {
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
    console.error("[GET /api/questions/:id]", err.message);
    return res.status(500).json({ error: "Failed to retrieve question" });
  }
}
