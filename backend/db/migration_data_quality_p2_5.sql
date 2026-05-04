-- P2-5 — entity portrait overrides
-- Per docs/data-pipeline-improvements-tracker.md
--
-- Editor-maintained dictionary keyed on entity name. The synthesizer's
-- attachWikipediaToEntities checks this table BEFORE running the
-- Wikipedia probe. When a row matches, the entity is stamped with the
-- override's portrait fields and the Wikipedia probe is skipped — so a
-- press photo with proper licensing wins over Wikipedia's lead image
-- on prominent figures.
--
-- Editor UI is deferred: maintain entries via direct SQL for now.
-- Schema is intentionally simple to make manual editing tolerable.
--
-- Idempotent. Run once in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS entity_portrait_overrides (
  -- Normalised lookup key — lowercased + trimmed entity name. The
  -- synthesizer normalises entity names the same way at lookup time.
  entity_name_norm  text PRIMARY KEY,

  -- Proper-cased reference name for editor convenience. Not used for
  -- matching — purely so the table is readable when manually inspected.
  display_name      text NOT NULL,

  -- Portrait image URLs. thumbnail_url is optional; image_url is the
  -- full-resolution source.
  image_url         text NOT NULL,
  thumbnail_url     text,

  -- Attribution string + license. BOTH required — we never render an
  -- override portrait without telling the viewer where it came from.
  attribution       text NOT NULL,
  license           text NOT NULL,

  -- Free-form editor notes. e.g. "Use this 2024 press photo; default
  -- Wikipedia lead is from 2017 and dated."
  notes             text,

  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Sort/lookup-by-display index for editor scrolling.
CREATE INDEX IF NOT EXISTS entity_portrait_overrides_display_idx
  ON entity_portrait_overrides (display_name);

-- Verification:
-- SELECT count(*) FROM entity_portrait_overrides;
-- SELECT * FROM entity_portrait_overrides WHERE entity_name_norm = lower(trim('Donald Trump'));
