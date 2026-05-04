-- P1-8 / P1-9 / P1-10 — data quality columns on stories
-- Per docs/data-pipeline-improvements-tracker.md
--
-- Adds:
--   P1-8  source_diversity_score / source_diversity_label
--           — distinct-domain count weighted by non-wire share, 0-1
--   P1-9  verification_status / verification_notes / corrections
--           — lifecycle state for editor approval and post-publish corrections
--   P1-10 factual_conflicts
--           — per-story numeric/factual divergence between sources, surfaced at synthesis
--
-- All columns are additive. Defaults preserve current behaviour: existing
-- rows score NULL diversity (adapter falls back), land in 'draft'
-- verification (back-filled to 'verified' when is_verified=true), and have
-- empty factual_conflicts. video-pipeline-v2's adapter must continue to
-- read with optional chaining — same pattern as `primary_places` and
-- `source_documents`.
--
-- Run once in Supabase SQL editor. Idempotent: IF NOT EXISTS guards on
-- every ADD COLUMN; the constraint and backfill are guarded too.

ALTER TABLE stories
  -- P1-8: weighted source-diversity score, 0-1 with three decimals.
  -- 0.6 * (distinct domains / 5, capped) + 0.4 * (non-wire / distinct).
  -- NULL on pre-P1-8 rows (synthesizer fills in on next write).
  ADD COLUMN IF NOT EXISTS source_diversity_score numeric(4,3),

  -- 'single' / 'narrow' / 'diverse' bucketing — one-glance editorial read.
  -- Mapping: < 0.3 single, 0.3-0.6 narrow, ≥ 0.6 diverse.
  ADD COLUMN IF NOT EXISTS source_diversity_label text,

  -- P1-9: verification lifecycle. CHECK constraint added separately so
  -- this ADD COLUMN stays idempotent.
  --   draft       — synthesizer-emitted, not yet editor-reviewed
  --   verified    — editor approved for downstream use
  --   published   — promoted to public surface (quiz, video render)
  --   corrected   — published row with at least one entry in `corrections`
  --   retracted   — pulled from circulation; downstream must skip
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'draft',

  -- Editor notes — free-form, surfaced in admin tooling, not for the renderer.
  ADD COLUMN IF NOT EXISTS verification_notes text,

  -- Corrections log: append-only history per row.
  -- Shape: [{ ts: ISO8601, what: text, by: editor_id_or_email }]
  ADD COLUMN IF NOT EXISTS corrections jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- P1-10: per-story factual conflicts. Shape:
  --   [{ claim: "fraud amount",
  --      values: ["$8B (DOJ)", "$10B (NYT)"],
  --      preferred: "$8B (DOJ)" }]
  -- Empty array is the honest "no detected conflicts" signal — distinct
  -- from NULL.
  ADD COLUMN IF NOT EXISTS factual_conflicts jsonb NOT NULL DEFAULT '[]'::jsonb;

-- CHECK constraint on verification_status — guarded so re-runs are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stories_verification_status_chk'
  ) THEN
    ALTER TABLE stories
      ADD CONSTRAINT stories_verification_status_chk
      CHECK (verification_status IN
        ('draft','verified','published','corrected','retracted'));
  END IF;
END $$;

-- One-time backfill: rows previously approved via is_verified land in
-- 'verified'; everything else stays at the 'draft' default. Editor can
-- promote rows to 'published' / 'corrected' / 'retracted' from there.
-- Guarded by `verification_status = 'draft'` so re-runs don't downgrade
-- editor-promoted rows.
UPDATE stories
   SET verification_status = 'verified'
 WHERE is_verified = true
   AND verification_status = 'draft';

-- Filter index for the renderer's "verified or better" pool.
CREATE INDEX IF NOT EXISTS stories_verification_status_idx
  ON stories (verification_status, published_at DESC);

-- Verification (run manually):
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'stories'
--     AND column_name IN ('source_diversity_score','source_diversity_label',
--                         'verification_status','verification_notes',
--                         'corrections','factual_conflicts');
