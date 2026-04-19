-- Phase 4 — Geo Pipeline schema additions
-- Run once in Supabase SQL editor.
-- Idempotent: IF NOT EXISTS / CHECK guards on all statements.
-- Fully additive — no existing column semantics change.

-- 4.1a raw_articles: per-article geo enrichment fields
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS source_country text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS source_region text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS mentioned_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS is_global_candidate boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS raw_articles_geo_idx
  ON raw_articles USING gin (mentioned_geos);

-- 4.1b clusters: per-cluster geo aggregation
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS primary_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS source_countries text[] NOT NULL DEFAULT '{}';

-- 4.1c stories: per-story geo metadata
ALTER TABLE stories ADD COLUMN IF NOT EXISTS primary_geos text[] NOT NULL DEFAULT '{}';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS geo_scores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS global_significance_score numeric(5,2) NOT NULL DEFAULT 0;

-- 4.1d story_audiences: new projection table (one row per (story, audience))
CREATE TABLE IF NOT EXISTS story_audiences (
  id               bigserial PRIMARY KEY,
  story_id         bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  audience_geo     text NOT NULL,
  relevance_score  numeric(5,2) NOT NULL DEFAULT 0,
  rank_bucket      text NOT NULL DEFAULT 'standard'
                   CHECK (rank_bucket IN ('hero', 'standard', 'tail', 'filler')),
  rank_priority    smallint NOT NULL DEFAULT 2
                   CHECK (rank_priority BETWEEN 1 AND 4),
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, audience_geo)
);

CREATE INDEX IF NOT EXISTS story_audiences_feed_idx
  ON story_audiences (audience_geo, rank_priority, relevance_score DESC);

CREATE INDEX IF NOT EXISTS story_audiences_story_idx
  ON story_audiences (story_id);

-- 4.3 Verification queries (run manually, commented out)
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='raw_articles' AND column_name IN
--     ('source_country','source_region','language','mentioned_geos','geo_scores','is_global_candidate');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='clusters' AND column_name IN
--     ('primary_geos','geo_scores','source_countries');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='stories' AND column_name IN
--     ('primary_geos','geo_scores','global_significance_score');
-- SELECT indexname FROM pg_indexes WHERE tablename='story_audiences';
