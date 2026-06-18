// Single source of truth for the daily-quiz Redis cache key. The writer
// (generateDaily) and the reader (serveQuestions) must agree byte-for-byte —
// a divergence silently sends every read to the slower Supabase fallback.
export function questionsKey(date, audience = "global") {
  return audience === "global" ? `questions:${date}` : `questions:${date}:${audience}`;
}
