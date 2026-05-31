-- Social Distribution Pipeline — Phase 0 schema additions
-- Run once in Supabase SQL editor.
-- Idempotent: IF NOT EXISTS / DO-guarded CHECK constraints on all statements.
-- Fully additive — does not touch ingestion, clustering, or synthesis tables.
--
-- NOTE (design vs. repo reality):
--   The design doc (social-distribution-pipeline-design.md §6) models story_id as
--   `uuid references stories(id)`. In THIS repo `stories.id` is `bigserial` (bigint)
--   — see migration_gold_set.sql — and story_audiences.story_id is `bigint`.
--   So every story_id FK below is `bigint`, matching the actual PK type.
--   The new social_* tables still use uuid surrogate PKs (gen_random_uuid()),
--   which is internally consistent and lets posts reference candidates by uuid.

-- ─────────────────────────────────────────────
-- social_publication_candidates
--   One candidate row per (story, audience_geo): the decision that a story may be
--   suitable for social distribution.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_publication_candidates (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  story_id          bigint       NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  audience_geo      text         NOT NULL,

  publish_reason    text,

  story_score       numeric(5,2) NOT NULL,
  relevance_score   numeric(5,2),
  confidence_score  int,

  category          text,
  sensitivity_level text         NOT NULL DEFAULT 'UNKNOWN'
                    CHECK (sensitivity_level IN ('LOW','MEDIUM','HIGH','UNKNOWN')),

  status            text         NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN (
                      'PENDING','APPROVED','REJECTED','AUTO_APPROVED',
                      'POST_GENERATED','POSTED','FAILED'
                    )),

  selected_at       timestamptz  NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  reviewer_notes    text,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (story_id, audience_geo)
);

-- Selector / admin queue scans by status
CREATE INDEX IF NOT EXISTS social_candidates_status_idx
  ON social_publication_candidates (status);

-- Lookups + dedupe by (story, audience)
CREATE INDEX IF NOT EXISTS social_candidates_story_geo_idx
  ON social_publication_candidates (story_id, audience_geo);

-- ─────────────────────────────────────────────
-- social_posts
--   One row per (story, platform, audience_geo): the platform-native rendering.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_posts (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  story_id          bigint       NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  candidate_id      uuid         REFERENCES social_publication_candidates(id) ON DELETE CASCADE,

  platform          text         NOT NULL
                    CHECK (platform IN ('x','facebook','instagram')),
  audience_geo      text         NOT NULL,

  post_text         text         NOT NULL,
  media_url         text,
  link_url          text,

  status            text         NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN (
                      'DRAFT','PENDING_REVIEW','APPROVED','REJECTED',
                      'SCHEDULED','PUBLISHING','POSTED','FAILED','SKIPPED'
                    )),

  scheduled_for     timestamptz,
  published_at      timestamptz,
  failed_at         timestamptz,

  platform_post_id  text,
  platform_response jsonb,
  error_message     text,

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (story_id, platform, audience_geo)
);

-- Publisher poll: due posts ready to go out
CREATE INDEX IF NOT EXISTS social_posts_publish_queue_idx
  ON social_posts (status, scheduled_for);

-- Lookups + dedupe by (story, audience)
CREATE INDEX IF NOT EXISTS social_posts_story_geo_idx
  ON social_posts (story_id, audience_geo);

-- ─────────────────────────────────────────────
-- social_media_assets
--   Visual assets for Instagram (required) and optionally X / Facebook.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_media_assets (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  story_id          bigint       NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  social_post_id    uuid         REFERENCES social_posts(id) ON DELETE CASCADE,

  asset_type        text         NOT NULL
                    CHECK (asset_type IN (
                      'instagram_square_card','instagram_vertical_card',
                      'instagram_carousel_slide','x_card','facebook_card'
                    )),
  asset_url         text         NOT NULL,

  width             int,
  height            int,
  format            text,

  generation_prompt text,
  generation_model  text,

  status            text         NOT NULL DEFAULT 'READY'
                    CHECK (status IN ('PENDING','GENERATING','READY','FAILED')),

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

-- Fetch a post's assets
CREATE INDEX IF NOT EXISTS social_media_assets_post_idx
  ON social_media_assets (social_post_id);

-- ─────────────────────────────────────────────
-- Verification (run manually, commented out)
-- ─────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name IN
--     ('social_publication_candidates','social_posts','social_media_assets');
-- SELECT indexname FROM pg_indexes
--   WHERE tablename IN
--     ('social_publication_candidates','social_posts','social_media_assets');
