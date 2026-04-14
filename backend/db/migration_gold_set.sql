-- Phase 1 — Gold Set Pipeline: clusters + stories tables
-- Run in Supabase SQL editor.
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.

-- ─────────────────────────────────────────────
-- clusters
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clusters (
  id                bigserial PRIMARY KEY,
  category_id       text        NOT NULL,
  primary_entities  text[]      NOT NULL DEFAULT '{}',
  article_ids       bigint[]    NOT NULL DEFAULT '{}',
  unique_domains    text[]      NOT NULL DEFAULT '{}',
  cluster_score     numeric(5,2) NOT NULL DEFAULT 0,
  last_scored_at    timestamptz,
  status            text        NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Main query index: fetch eligible clusters for synthesis
CREATE INDEX IF NOT EXISTS clusters_eligible_idx
  ON clusters (category_id, status, cluster_score DESC);

-- Cleanup / recency index
CREATE INDEX IF NOT EXISTS clusters_updated_idx
  ON clusters (updated_at DESC);

-- ─────────────────────────────────────────────
-- stories
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stories (
  id                bigserial PRIMARY KEY,
  cluster_id        bigint      REFERENCES clusters(id) ON DELETE SET NULL,
  category_id       text        NOT NULL,
  primary_entities  text[]      NOT NULL DEFAULT '{}',
  headline          text        NOT NULL,
  summary           text        NOT NULL,
  key_points        jsonb       NOT NULL DEFAULT '[]',
  confidence_score  int         NOT NULL CHECK (confidence_score BETWEEN 1 AND 10),
  story_score       numeric(5,2) NOT NULL DEFAULT 0,
  consistency_score numeric(4,3) NOT NULL DEFAULT 0,
  source_count      int         NOT NULL DEFAULT 0,
  is_verified       boolean     NOT NULL DEFAULT false,
  published_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Browse by category sorted by quality
CREATE INDEX IF NOT EXISTS stories_category_score_idx
  ON stories (category_id, story_score DESC);

-- Join back to source cluster
CREATE INDEX IF NOT EXISTS stories_cluster_idx
  ON stories (cluster_id);

-- Review queue: unverified stories newest first
CREATE INDEX IF NOT EXISTS stories_review_idx
  ON stories (is_verified, published_at DESC);
