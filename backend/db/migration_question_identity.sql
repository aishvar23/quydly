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

-- All-categories serving walks this index: audience + date prefix, newest first.
CREATE INDEX IF NOT EXISTS quiz_questions_serve_idx
  ON quiz_questions (audience, date DESC, category_id);

-- Beat (single-category) serving needs category_id BEFORE date so the equality
-- prefix is used and ORDER BY date DESC needs no sort. The serve_idx above puts
-- date before category_id, so it can't satisfy the category-filtered query
-- efficiently — this index does.
CREATE INDEX IF NOT EXISTS quiz_questions_beat_idx
  ON quiz_questions (audience, category_id, date DESC);

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
--   categories. Called via supabase.rpc('serve_unseen', {...}).
--
--   Branches on p_category instead of `(p_category IS NULL OR category_id=...)`
--   so each query is sargable: the NULL branch uses quiz_questions_serve_idx
--   (audience, date DESC); the category branch uses quiz_questions_beat_idx
--   (audience, category_id, date DESC). The OR-NULL form defeats both indexes.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION serve_unseen(
  p_user     uuid,
  p_audience text,
  p_category text,
  p_today    date,
  p_limit    int
) RETURNS SETOF quiz_questions
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_category IS NULL THEN
    RETURN QUERY
      SELECT q.* FROM quiz_questions q
      WHERE q.audience = p_audience
        AND q.date <= p_today                    -- never serve a future-dated row
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
        AND NOT EXISTS (
          SELECT 1 FROM user_question_attempts a
          WHERE a.user_id = p_user AND a.question_id = q.id)
      ORDER BY q.date DESC, q.created_at ASC
      LIMIT p_limit;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────
-- bump_daily_session(user, date, score)
--   Atomically advance the per-day session counter and return the new value.
--   A single INSERT ... ON CONFLICT DO UPDATE avoids the lost-update race of a
--   read-then-write (two concurrent completions could otherwise both read N and
--   both write N+1). Called from POST /api/complete.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bump_daily_session(
  p_user  uuid,
  p_date  date,
  p_score int
) RETURNS int
LANGUAGE sql AS $$
  INSERT INTO user_daily_progress (user_id, date, sessions_completed, total_score)
  VALUES (p_user, p_date, 1, p_score)
  ON CONFLICT (user_id, date) DO UPDATE
    SET sessions_completed = user_daily_progress.sessions_completed + 1,
        total_score        = p_score
  RETURNING sessions_completed;
$$;

-- ─────────────────────────────────────────────
-- Verification (run manually, commented out)
-- ─────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('quiz_questions', 'user_question_attempts');
-- SELECT * FROM serve_unseen('<user-uuid>', 'global', NULL, current_date, 10);
