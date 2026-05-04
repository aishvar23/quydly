-- P2-4 — multi-language source handling
-- Per docs/data-pipeline-improvements-tracker.md
--
-- Adds story-level rollup of source-language signals from raw_articles.
-- Translation introduces drift; flagging stories whose synthesis relied on
-- non-English sources lets the editor verify before the renderer ships.
--
-- Two columns:
--   original_languages   — sorted unique ISO codes from feed metadata +
--                          script detection on article bodies
--   translation_required — true when any source article is non-English by
--                          either signal
--
-- raw_articles.language already exists (set by scraper from feed
-- metadata); no schema change there. Logic lives in
-- azure-functions/lib/languageDetection.js.
--
-- Additive + idempotent. Run once in Supabase SQL editor.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS original_languages   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS translation_required boolean;

-- Filter index for editor queries: "show me all stories that need
-- translation review". Partial — only indexes true rows since false is
-- the steady-state majority.
CREATE INDEX IF NOT EXISTS stories_translation_required_idx
  ON stories (translation_required, published_at DESC)
  WHERE translation_required = true;

-- Verification:
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'stories'
--     AND column_name IN ('original_languages','translation_required');
