-- Social Questions — shareable single-question pages for X reply links
-- Run once in Supabase SQL editor.
-- Idempotent: IF NOT EXISTS guards on every statement.
-- Fully additive — touches no existing rows; only adds one table + one column.
--
-- Purpose:
--   When the pipeline generates an X post, it now also persists the STRUCTURED
--   quiz question it tweets (question + 4 options + correct index + TL;DR) as an
--   addressable row here. Its uuid `id` is the <questionId> in the reply link
--   quydly.com/question/<id>, which opens the single-question quiz page.
--   Decoupled from the daily quiz pool (daily_questions) by design — this is the
--   exact question that was tweeted, frozen at post-generation time.

-- ─────────────────────────────────────────────
-- social_questions
--   One row per tweeted question. id is the public <questionId>.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_questions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  story_id      bigint      NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  audience_geo  text        NOT NULL,

  question      text        NOT NULL,
  options       jsonb       NOT NULL,          -- array of exactly 4 strings
  correct_index int         NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  tldr          text        NOT NULL,
  category_id   text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Lookups by source story (e.g. dedupe / admin)
CREATE INDEX IF NOT EXISTS social_questions_story_idx
  ON social_questions (story_id);

-- ─────────────────────────────────────────────
-- social_posts.social_question_id
--   The publisher reads this at publish time to build the reply link.
-- ─────────────────────────────────────────────
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS social_question_id uuid
  REFERENCES social_questions(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- Verification (run manually, commented out)
-- ─────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'social_questions';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'social_posts' AND column_name = 'social_question_id';
