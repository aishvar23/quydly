-- P0-5 + P1 batch — enrichment columns on stories
-- Per docs/data-pipeline-improvements-tracker.md
--
-- Adds the structured fields the video pipeline expects beyond the core
-- headline / summary / key_points trio. The synthesiser fills these via
-- a non-essential Claude pass (azure-functions/lib/enrichment.js) plus
-- a Wikipedia probe step (azure-functions/lib/wikipedia.js).
--
-- All columns are additive and nullable / default-empty. Existing rows
-- will surface NULL (or empty arrays) after the ALTER and the video
-- pipeline's adapter must continue to fall back gracefully — same
-- pattern already in use for `primary_places` and `source_documents`.
--
-- Run once in Supabase SQL editor. Idempotent: IF NOT EXISTS guards
-- every ADD COLUMN.

ALTER TABLE stories
  -- P0-5: granular story_type. Synthesiser-emitted, validated against the
  -- closed enum in azure-functions/lib/enrichment.js (STORY_TYPES). NULL on
  -- pre-enrichment rows; 'general' on post-enrichment rows whose archetype
  -- genuinely doesn't fit a specialised bucket.
  ADD COLUMN IF NOT EXISTS story_type        text,

  -- P1-3: editorial posture chip. Enum in EDITORIAL_POSTURES.
  ADD COLUMN IF NOT EXISTS editorial_posture text,

  -- P1-2: spoken-word hook for the first 3 seconds of the video.
  -- 8-22 words, declarative (validator rejects question marks).
  ADD COLUMN IF NOT EXISTS hook_sentence     text,

  -- P1-7: stakes line — one sentence on what this means for the viewer.
  ADD COLUMN IF NOT EXISTS why_it_matters    text,

  -- P1-1: structured numeric extraction. Shape:
  --   { money:[], counts:[], percentages:[], magnitudes:[], casualties:[] }
  -- Each entry is { display, value, role|unit|label }. Default is the empty
  -- object so video-pipeline-v2 can read with optional chaining.
  ADD COLUMN IF NOT EXISTS structured_numbers jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- P1-5: timeline events. Each entry is { date: "YYYY-MM-DD", label, source_id }
  -- where source_id is the raw_articles id that supports the date (or NULL).
  ADD COLUMN IF NOT EXISTS timeline_events    jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- P0-4 + P1-4 + P1-6: enriched entities with type / role / context plus
  -- Wikipedia probe metadata. Shape:
  --   [{
  --     "name":  "Sam Bankman-Fried",
  --     "type":  "person|place|org",
  --     "role":  "defendant",
  --     "context": "One-sentence bio.",
  --     -- populated by P0-4 Wikipedia probe (resolved=true case):
  --     "wikipedia_url":           "https://en.wikipedia.org/wiki/Sam_Bankman-Fried",
  --     "wikipedia_thumbnail_url": "https://upload.wikimedia.org/.../320px-Sam_Bankman-Fried.jpg",
  --     "wikipedia_summary":       "Samuel Bankman-Fried is an American businessman ...",
  --     "wikipedia_title":         "Sam Bankman-Fried",
  --     "image_license":           "Wikipedia: see source page",
  --     "wiki_resolved":           true
  --     -- on resolved=false: { wiki_resolved:false, wiki_reason:"redirect_refused" } etc.
  --   }, ...]
  -- Parallel to `primary_entities text[]` (which stays as the original
  -- cluster-derived flat list for backward compatibility).
  ADD COLUMN IF NOT EXISTS primary_entities_enriched jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Indexes deferred. Current consumers (video-pipeline-v2 + story selector)
-- read these fields by primary key on stories or as part of a row scan
-- already filtered by published_at / category_id. Add a GIN index when a
-- query first needs to filter inside the JSON.

-- Verification (run manually):
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'stories'
--     AND column_name IN ('story_type','editorial_posture','hook_sentence',
--                         'why_it_matters','structured_numbers',
--                         'timeline_events','primary_entities_enriched');
