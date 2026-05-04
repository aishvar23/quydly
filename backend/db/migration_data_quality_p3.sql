-- P3-4 — timeline_disposition column
-- Per docs/data-pipeline-improvements-tracker.md
--
-- The timeline-quality gate (azure-functions/lib/enrichment.js
-- enforceTimelineQuality) classifies each story's timeline as
-- "absent" / "single_day" / "multi_day" / "fallback" so the renderer
-- can suppress TimelineCard on weak timelines without re-deriving the
-- check at render time.
--
-- All other columns referenced in P3-1/2/3 already exist (geo lib +
-- synthesizer changes don't touch the schema).
--
-- Additive + idempotent. Run once in Supabase SQL editor.

ALTER TABLE stories
  -- "absent"    — no events derivable from any source
  -- "single_day" — events all collapse to one date; TimelineCard should skip
  -- "multi_day"  — ≥ 2 distinct dates from the LLM-extracted events
  -- "fallback"   — LLM thin, but article-date fallback yielded multi-day events
  ADD COLUMN IF NOT EXISTS timeline_disposition text;

-- CHECK constraint guarded so re-runs are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stories_timeline_disposition_chk'
  ) THEN
    ALTER TABLE stories
      ADD CONSTRAINT stories_timeline_disposition_chk
      CHECK (timeline_disposition IS NULL OR timeline_disposition IN
        ('absent','single_day','multi_day','fallback'));
  END IF;
END $$;

-- Verification:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'stories' AND column_name = 'timeline_disposition';
