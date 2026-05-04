-- P0-3 — Readable place names on stories
-- Per docs/data-pipeline-improvements-tracker.md
--
-- Why: today stories carry primary_geos as ISO codes only ("us"). The video
-- pipeline has to translate via a hand-curated COUNTRY_CODE_TO_NAME map and
-- falls back to Mapbox geocoding for unknowns. Storing the readable form at
-- synthesis time means MapCallout + place-photo lookups can skip translation.
--
-- The column accepts richer entries — admin region and lat/lon — without
-- another migration as we layer on better extraction.
--
-- Run once in Supabase SQL editor. Idempotent: IF NOT EXISTS.
-- Fully additive — primary_geos stays as the canonical ISO-code roll-up.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS primary_places jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Shape (one entry per primary geo, parallel ordering with primary_geos):
--   [{
--     "code":  "us",
--     "name":  "United States",
--     -- optional, populated as gazetteer/Mapbox enrichment lands:
--     "admin": "New York",
--     "lat":   40.7128,
--     "lon":   -74.0060
--   }, ...]
--
-- Verification (run manually):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='stories' AND column_name='primary_places';
