-- P2 batch — polish columns on stories
-- Per docs/data-pipeline-improvements-tracker.md
--
-- Adds:
--   P2-1  visual_concepts
--           — 3-5 short concrete visuals the renderer can map to module beats
--   P2-3  video_eligible / video_skip_reason
--           — pre-flagged gate so the editor / video pipeline can batch-skip
--             low-quality candidates without re-deriving the same rule chain
--   P2-6  story_decay_at
--           — per-story expiry timestamp; older stories surface an ARCHIVE
--             posture chip rather than masquerading as breaking news
--
-- (P2-7 phonetic hints land inside the existing primary_entities_enriched
--  jsonb; no schema change needed.)
--
-- All columns are additive. Existing rows surface NULL / empty defaults and
-- the video pipeline's adapter must continue to read with optional chaining
-- — same backward-compat pattern as `primary_places`, `source_documents`,
-- and the P1 enrichment columns.
--
-- Run once in Supabase SQL editor. Idempotent: IF NOT EXISTS guards on every
-- ADD COLUMN.

ALTER TABLE stories
  -- P2-1: visual concepts. Shape: ["Manhattan federal courthouse exterior", ...]
  -- Editor-browseable list of concrete visuals; future module types (ChartCard,
  -- DiagramCard) can match on these strings. Empty array is the honest "we
  -- didn't propose any visuals" signal.
  ADD COLUMN IF NOT EXISTS visual_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- P2-3: editorial gate for video render. NULL on pre-P2 rows (adapter
  -- treats NULL as "unknown — fall back to runtime audit"). Synthesizer
  -- writes true/false on every new row; the rule set lives in
  -- azure-functions/lib/videoEligibility.js.
  ADD COLUMN IF NOT EXISTS video_eligible boolean,

  -- Free-form reason string when video_eligible = false. NULL when eligible.
  -- Surfaces in editor tooling so the rule that excluded a story is visible
  -- without re-running the gate.
  ADD COLUMN IF NOT EXISTS video_skip_reason text,

  -- P2-6: story freshness decay timestamp. After this point the renderer
  -- should surface the story with an ARCHIVE posture chip rather than treat
  -- it as current news. Per-category decay windows live in
  -- azure-functions/lib/freshness.js. NULL on pre-P2 rows (adapter falls
  -- back to a default freshness check).
  ADD COLUMN IF NOT EXISTS story_decay_at timestamptz;

-- Filter index for the renderer's "still-fresh" pool.
CREATE INDEX IF NOT EXISTS stories_story_decay_at_idx
  ON stories (story_decay_at);

-- Filter index for batch-fetching video-eligible stories.
CREATE INDEX IF NOT EXISTS stories_video_eligible_idx
  ON stories (video_eligible, published_at DESC)
  WHERE video_eligible = true;

-- Verification (run manually):
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'stories'
--     AND column_name IN ('visual_concepts','video_eligible',
--                         'video_skip_reason','story_decay_at');
