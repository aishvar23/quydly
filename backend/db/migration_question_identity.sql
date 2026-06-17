-- Per-question identity + per-user attempt checkpoint
-- Run once in the Supabase SQL editor.
-- Idempotent: IF NOT EXISTS / OR REPLACE guards on every statement.
-- Fully additive — touches no existing rows; adds two tables + one RPC.
--
-- Purpose:
--   The daily quiz previously lived only as a jsonb blob (daily_questions /
--   Redis) with NO stable per-question id, and the system tracked only a
--   per-user *session counter* — never *which questions* a user had seen.
--   This migration introduces the two missing primitives:
--     1. quiz_questions      — one addressable row per generated question.
--     2. user_question_attempts — the per-user "checkpoint": the set of
--        question ids a user has already attempted.
--   From these, serving newest-unseen across multiple days, no-overlap when a
--   guest signs in (anon + signed-in share one user_id), beat filtering, and
--   "you are all caught up" all fall out of one query (serve_unseen below).

-- ─────────────────────────────────────────────
-- quiz_questions
--   Durable source of truth for the signed-in, unbounded, multi-day backlog.
--   generateDaily writes a row per question for BOTH audiences (unlike
--   daily_questions, which is global-only) and embeds the same id into the
--   cached jsonb so the anonymous free-5 path can report attempts too.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_questions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date        NOT NULL,
  audience      text        NOT NULL DEFAULT 'global',   -- 'global' | 'india'
  category_id   text        NOT NULL,
  question      text        NOT NULL,
  options       jsonb       NOT NULL,                    -- array of exactly 4 strings
  correct_index int         NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  tldr          text        NOT NULL,
  story_id      bigint      REFERENCES stories(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Serving walks this index: filter by audience [+ category], newest date first.
CREATE INDEX IF NOT EXISTS quiz_questions_serve_idx
  ON quiz_questions (audience, date DESC, category_id);

-- ─────────────────────────────────────────────
-- user_question_attempts
--   The "checkpoint." One row per (user, question) the user has attempted.
--   PK makes re-recording idempotent. ON DELETE CASCADE keeps it clean if a
--   day's quiz_questions are replaced by an admin re-generation.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_question_attempts (
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id  uuid        NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  correct      boolean,
  delta        int,
  PRIMARY KEY (user_id, question_id)
);

-- Supports the anti-join in serve_unseen (exclude this user's attempted ids).
CREATE INDEX IF NOT EXISTS uqa_user_idx
  ON user_question_attempts (user_id);

-- ─────────────────────────────────────────────
-- serve_unseen(user, audience, category, today, limit)
--   Next page of questions a signed-in user has NOT attempted, newest day
--   first, reaching back across days until none remain. p_category NULL = all
--   categories. The supabase-js builder can't express NOT EXISTS cleanly, so
--   this is called via supabase.rpc('serve_unseen', {...}).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION serve_unseen(
  p_user     uuid,
  p_audience text,
  p_category text,
  p_today    date,
  p_limit    int
) RETURNS SETOF quiz_questions
LANGUAGE sql STABLE AS $$
  SELECT q.*
  FROM quiz_questions q
  WHERE q.audience = p_audience
    AND (p_category IS NULL OR q.category_id = p_category)
    AND q.date <= p_today                       -- never serve a future-dated row
    AND NOT EXISTS (
      SELECT 1 FROM user_question_attempts a
      WHERE a.user_id = p_user AND a.question_id = q.id
    )
  ORDER BY q.date DESC, q.created_at ASC
  LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────
-- Verification (run manually, commented out)
-- ─────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('quiz_questions', 'user_question_attempts');
-- SELECT * FROM serve_unseen('<user-uuid>', 'global', NULL, current_date, 10);
