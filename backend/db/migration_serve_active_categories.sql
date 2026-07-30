-- Retired-category filtering for serve_unseen
-- Run once in the Supabase SQL editor (or via supabase migration tooling).
-- Idempotent: DROP IF EXISTS + CREATE OR REPLACE.
--
-- Purpose:
--   Retiring a category (culture, 2026-07-30) removes it from generation, but
--   the all-beats branch of serve_unseen reached back across ALL prior days
--   with no category filter, so signed-in users kept receiving the retired
--   vertical's historical backlog until they exhausted it. The active-category
--   list lives in JS config (config/categories.js EDITORIAL_MIX — the single
--   source of truth for participation), so it is passed in per call rather
--   than duplicated here.
--
--   p_active_categories DEFAULT NULL keeps the change backward compatible:
--   NULL (or an omitted argument, e.g. from a not-yet-redeployed backend)
--   preserves the unfiltered behavior. The old 5-arg function MUST be dropped,
--   not left alongside — two overloads would make 5-named-arg PostgREST calls
--   ambiguous ("function is not unique").

DROP FUNCTION IF EXISTS serve_unseen(uuid, text, text, date, int);

CREATE OR REPLACE FUNCTION serve_unseen(
  p_user              uuid,
  p_audience          text,
  p_category          text,
  p_today             date,
  p_limit             int,
  p_active_categories text[] DEFAULT NULL
) RETURNS SETOF quiz_questions
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_category IS NULL THEN
    RETURN QUERY
      SELECT q.* FROM quiz_questions q
      WHERE q.audience = p_audience
        AND q.date <= p_today                    -- never serve a future-dated row
        AND (p_active_categories IS NULL OR q.category_id = ANY(p_active_categories))
        AND NOT EXISTS (
          SELECT 1 FROM user_question_attempts a
          WHERE a.user_id = p_user AND a.question_id = q.id)
      ORDER BY q.date DESC, q.created_at ASC
      LIMIT p_limit;
  ELSE
    RETURN QUERY
      SELECT q.* FROM quiz_questions q
      WHERE q.audience = p_audience
        AND q.category_id = p_category
        AND q.date <= p_today
        AND (p_active_categories IS NULL OR q.category_id = ANY(p_active_categories))
        AND NOT EXISTS (
          SELECT 1 FROM user_question_attempts a
          WHERE a.user_id = p_user AND a.question_id = q.id)
      ORDER BY q.date DESC, q.created_at ASC
      LIMIT p_limit;
  END IF;
END;
$$;

-- Verification (run manually, commented out)
-- SELECT * FROM serve_unseen('<user-uuid>', 'global', NULL, current_date, 10);
-- SELECT * FROM serve_unseen('<user-uuid>', 'global', NULL, current_date, 10,
--   ARRAY['world','tech','ai','finance','sports']);
