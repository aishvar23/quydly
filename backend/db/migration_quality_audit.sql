-- Phase 7 — Story Quality Audit
-- Run once in Supabase SQL editor. Idempotent.

-- 7.1 Add quality audit columns to stories
ALTER TABLE stories ADD COLUMN IF NOT EXISTS specificity_score  numeric(4,2);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS coherence_score    numeric(4,2);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS support_score      numeric(4,2);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS quizability_score  numeric(4,2);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS quality_flags      text[]      NOT NULL DEFAULT '{}';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS quiz_candidate     boolean     NOT NULL DEFAULT false;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS audited_at         timestamptz;

-- 7.2 Partial index: fast quiz pool queries (only scans candidate rows)
CREATE INDEX IF NOT EXISTS stories_quiz_pool_idx
  ON stories (category_id, quizability_score DESC, story_score DESC)
  WHERE quiz_candidate = true;

-- 7.3 Audit log table (append-only history per story)
CREATE TABLE IF NOT EXISTS story_quality_audits (
  id                bigserial    PRIMARY KEY,
  story_id          bigint       NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  specificity_score numeric(4,2) NOT NULL,
  coherence_score   numeric(4,2) NOT NULL,
  support_score     numeric(4,2) NOT NULL,
  quizability_score numeric(4,2) NOT NULL,
  quality_flags     text[]       NOT NULL DEFAULT '{}',
  decision          text         NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason            text,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_quality_audits_story_idx
  ON story_quality_audits (story_id);
