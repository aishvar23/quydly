-- Phase 1.2 — raw_articles table
-- Status: DONE | PARTIAL | LOW_QUALITY

CREATE TABLE IF NOT EXISTS raw_articles (
  id               bigserial PRIMARY KEY,
  url_hash         char(64) NOT NULL UNIQUE,  -- SHA256(canonical_url)
  canonical_url    text     NOT NULL,
  domain           text     NOT NULL,
  category_id      text     NOT NULL,
  title            text     NOT NULL,
  description      text,
  content          text,
  content_hash     char(64),                  -- SHA256(content) for dedup
  author           text,
  published_at     timestamptz,
  authority_score  numeric(3,2) NOT NULL DEFAULT 0.5,
  status           text     NOT NULL DEFAULT 'DONE'
                   CHECK (status IN ('DONE','PARTIAL','LOW_QUALITY')),
  is_verified      boolean  NOT NULL DEFAULT false,
  scraped_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_articles_query_idx
  ON raw_articles (category_id, is_verified, status, published_at DESC);

CREATE INDEX IF NOT EXISTS raw_articles_authority_idx
  ON raw_articles (authority_score DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS raw_articles_cleanup_idx
  ON raw_articles (scraped_at, status);
