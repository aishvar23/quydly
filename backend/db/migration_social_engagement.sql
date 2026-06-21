-- Social Distribution Pipeline — Instagram engagement question + answer comment
-- Run once in Supabase SQL editor.
-- Idempotent: IF NOT EXISTS guards on every statement.
-- Fully additive — touches no existing rows; only adds one table + its indexes.
--
-- Purpose:
--   The Instagram carousel gains an "engagement" slide (second-to-last, before
--   the CTA) that poses a multiple-choice question drawn from YESTERDAY'S story
--   — i.e. the story behind the most recent POSTED IG post for the same
--   audience_geo — inviting followers to reply with their pick. Twelve hours
--   after the post goes live we (eventually) post the ANSWER as a comment on the
--   same IG media.
--
--   This table is the durable record tying that loop together: one row per IG
--   post that carried an engagement slide. The post-generator writes it at
--   generation time (comment_status='PENDING'); the publisher fills in the IG
--   media id + due time and flips it to 'SCHEDULED' when the post goes live; a
--   future comment-publisher worker (DEFERRED — see below) claims the due
--   SCHEDULED rows, posts the answer comment, and flips them to 'POSTED'.
--
-- COMMENT WORKER (now built — gated on the Meta token scope + this migration):
--   The comment-posting step is the timer worker social-comment-publisher +
--   instagram-graph.js postComment(). Both are now implemented. They run only
--   when SOCIAL_IG_ENGAGEMENT_ENABLED is on, META_PAGE_ACCESS_TOKEN is set, AND
--   that token carries `instagram_manage_comments`. Until this migration is
--   applied and the prod token is rotated to one with that scope, SCHEDULED rows
--   simply accumulate (the worker is a no-op / leaves them SCHEDULED).

-- ─────────────────────────────────────────────
-- social_post_engagement
--   One row per IG post that carried an engagement (MCQ) slide. The MCQ is the
--   one rendered on that post's engagement slide; it is drawn from the PREVIOUS
--   post's story (source_post_id), so the answer comment posted 12h later reveals
--   the answer to the question this post asked.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_post_engagement (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The IG post whose carousel carries the engagement slide. One engagement row
  -- per post (UNIQUE) — a re-generation upserts rather than duplicating.
  social_post_id     uuid        NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,

  -- The PREVIOUS IG post whose story sourced this MCQ (the "yesterday's question"
  -- the answer comment will reveal). Nullable + ON DELETE SET NULL so deleting an
  -- old post never cascades away a live engagement row.
  source_post_id     uuid        REFERENCES social_posts(id) ON DELETE SET NULL,

  audience_geo       text        NOT NULL,

  -- The multiple-choice question rendered on the slide, frozen at generation time.
  question           text        NOT NULL,
  options            jsonb       NOT NULL,          -- array of exactly 4 strings
  correct_index      int         NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  answer             text        NOT NULL,          -- options[correct_index], denormalised for the comment

  -- IG media id of the published post (filled by the publisher on POSTED). This
  -- is the media the answer comment is posted against.
  ig_media_id        text,

  -- Comment scheduling lifecycle:
  --   PENDING    — row written at generation; post not yet published.
  --   SCHEDULED  — post is POSTED; comment_due_at + ig_media_id set; ready to post.
  --   COMMENTING — claimed by the comment-publisher worker (exactly-once guard).
  --   POSTED     — answer comment posted (set by the comment worker).
  --   FAILED     — comment post failed (set by the comment worker, after retries).
  comment_status     text        NOT NULL DEFAULT 'PENDING'
                     CHECK (comment_status IN ('PENDING','SCHEDULED','COMMENTING','POSTED','FAILED')),
  comment_due_at     timestamptz,                   -- published_at + 12h (set on POSTED)
  comment_platform_id text,                         -- IG comment id once posted
  error_message      text,

  -- Bounded retry: the comment worker bumps this each time it claims a row; once
  -- it reaches the worker's cap the row is left FAILED (terminal) instead of being
  -- re-claimed. Defaults to 0 so existing rows need no backfill.
  comment_attempts   int         NOT NULL DEFAULT 0,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- One engagement row per IG post — lets the generator upsert idempotently.
  UNIQUE (social_post_id)
);

-- The comment worker's claim query: due, SCHEDULED rows, oldest first.
CREATE INDEX IF NOT EXISTS social_post_engagement_due_idx
  ON social_post_engagement (comment_status, comment_due_at);

-- ─────────────────────────────────────────────
-- Verification (run manually, commented out)
-- ─────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'social_post_engagement';
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'social_post_engagement'
--     AND indexname = 'social_post_engagement_due_idx';
