-- P0-1 — Source documents snapshot on stories
-- Per docs/data-pipeline-improvements-tracker.md
--
-- Why: cluster.article_ids references raw_articles which gets retention-pruned.
-- Without this column, every Supabase story renders with an empty EvidenceShelf
-- in video-pipeline-v2 because the joined articles are gone.
--
-- Run once in Supabase SQL editor. Idempotent: IF NOT EXISTS.
-- Fully additive — no existing column semantics change.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS source_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Shape (one element per source article snapshotted at synthesis time):
--   [{
--     "id":            "raw_article_id",
--     "type":          "article",
--     "title":         "...",
--     "issuer":        "domain.com",
--     "url":           "https://...",
--     "date":          "2026-05-04T12:00:00Z",
--     "authority":     0.85,
--     "source_country": "us",
--     -- populated by P0-2 (verbatim quotes) where extractable:
--     "quote_text":    "...",
--     "quote_speaker": "...",
--     "quote_role":    "..."
--   }, ...]
--
-- No GIN index yet — current consumer (video-pipeline-v2) reads source_documents
-- by primary key on stories, no JSON-shape filtering. Add when first query needs it.

-- Verification (run manually):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='stories' AND column_name='source_documents';
