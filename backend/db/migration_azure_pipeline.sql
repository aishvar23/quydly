-- Phase 2 — Azure Queue Pipeline schema additions
-- Run once in Supabase SQL editor.
-- Idempotent: IF NOT EXISTS / IF EXISTS guards on all statements.

-- 2.1 Add clustered_at to raw_articles
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS clustered_at timestamptz;

-- 2.2 Partial index for the article-clusterer's SELECT
--     Only covers rows that still need clustering — keeps the index small.
CREATE INDEX IF NOT EXISTS idx_raw_articles_unprocessed
  ON raw_articles (ingested_at)
  WHERE clustered_at IS NULL AND status = 'DONE';

-- 2.3 Add synthesis_queued_at to clusters
--     Used by article-clusterer to gate duplicate synthesize-queue sends.
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS synthesis_queued_at timestamptz;

-- 2.4 Verify: existing rows have clustered_at = NULL (no backfill needed)
-- SELECT COUNT(*) FROM raw_articles WHERE clustered_at IS NOT NULL;
-- Expected: 0
