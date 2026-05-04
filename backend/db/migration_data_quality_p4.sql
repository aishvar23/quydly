-- P2-2 + P4-2 — related_stories column + decay backfill
-- Per docs/data-pipeline-improvements-tracker.md
--
-- P2-2: adds `related_stories jsonb` for the Story Arc module — ≤ 3
--       prior stories in same category that share ≥ 2 entities with
--       the current row, computed at synth time. Default empty array.
--
-- P4-2: one-time backfill of NULL story_decay_at on pre-P2-6 rows.
--       The original P2-6 design pinned decay to publication and never
--       updated on River-merge — correct in steady state, but pre-P2-6
--       rows have NULL forever and effectively opt out of the
--       renderer's freshness check (no ARCHIVE chip on historical
--       content). The synthesizer's UPDATE branch is also updated (in
--       code) to COALESCE on every re-synth, so any rows synthesised
--       between this migration and the next clusterer run self-heal.
--
-- Per-category decay windows mirror azure-functions/lib/freshness.js:
--   world   45d   tech    60d   finance 30d
--   culture 21d   science 90d   default 30d
--
-- All operations idempotent. Run once in Supabase SQL editor.

-- ── P2-2 schema ─────────────────────────────────────────────────────────────

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS related_stories jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── P4-2 backfill ───────────────────────────────────────────────────────────

UPDATE stories
   SET story_decay_at = published_at + interval '45 days'
 WHERE story_decay_at IS NULL
   AND category_id = 'world';

UPDATE stories
   SET story_decay_at = published_at + interval '60 days'
 WHERE story_decay_at IS NULL
   AND category_id = 'tech';

UPDATE stories
   SET story_decay_at = published_at + interval '30 days'
 WHERE story_decay_at IS NULL
   AND category_id = 'finance';

UPDATE stories
   SET story_decay_at = published_at + interval '21 days'
 WHERE story_decay_at IS NULL
   AND category_id = 'culture';

UPDATE stories
   SET story_decay_at = published_at + interval '90 days'
 WHERE story_decay_at IS NULL
   AND category_id = 'science';

-- Default (unknown / unmapped category): 30 days.
UPDATE stories
   SET story_decay_at = published_at + interval '30 days'
 WHERE story_decay_at IS NULL
   AND published_at IS NOT NULL;

-- Verification:
-- SELECT count(*) FROM stories WHERE story_decay_at IS NULL;
-- SELECT category_id, count(*), min(story_decay_at), max(story_decay_at)
--   FROM stories GROUP BY category_id;
