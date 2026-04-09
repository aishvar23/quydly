-- Phase 1.1 — scrape_queue table
-- Status: PENDING → PROCESSING → DONE | PARTIAL | LOW_QUALITY | FAILED

CREATE TABLE IF NOT EXISTS scrape_queue (
  id               bigserial PRIMARY KEY,
  url_hash         char(64) NOT NULL UNIQUE,  -- SHA256(canonical_url)
  canonical_url    text     NOT NULL,
  domain           text     NOT NULL,
  category_id      text     NOT NULL,
  authority_score  numeric(3,2) NOT NULL DEFAULT 0.5,
  status           text     NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PROCESSING','DONE','PARTIAL','LOW_QUALITY','FAILED')),
  retry_count      smallint NOT NULL DEFAULT 0,
  last_error       text,
  discovered_at    timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS scrape_queue_status_idx
  ON scrape_queue (status, discovered_at);

CREATE INDEX IF NOT EXISTS scrape_queue_domain_idx
  ON scrape_queue (domain, status);
