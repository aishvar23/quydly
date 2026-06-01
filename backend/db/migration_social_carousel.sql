-- Social Distribution Pipeline — Instagram carousel (tracker L4)
-- Run once in Supabase SQL editor. Idempotent + fully additive.
--
-- The base schema (migration_social_distribution.sql) already defines
-- social_media_assets with asset_type 'instagram_carousel_slide'. A carousel is
-- an ORDERED set of slides, but the table had no ordering column — add one.
-- The publisher reads a post's carousel slides ordered by `position`.

-- Slide order within a carousel (0 = cover). Single-image cards leave it at 0.
ALTER TABLE social_media_assets
  ADD COLUMN IF NOT EXISTS position int NOT NULL DEFAULT 0;

-- One asset per (post, position): lets the generator upsert slides idempotently
-- (a retried generation re-renders the same 4 slides without duplicating rows).
CREATE UNIQUE INDEX IF NOT EXISTS social_media_assets_post_position_idx
  ON social_media_assets (social_post_id, position);

-- ─────────────────────────────────────────────
-- Verification (run manually, commented out)
-- ─────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'social_media_assets' AND column_name = 'position';
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'social_media_assets'
--     AND indexname = 'social_media_assets_post_position_idx';
