-- Geo Pipeline Observability Queries (Phase 9.4–9.6)
-- Run in Supabase SQL editor or any Postgres client.

-- 9.4 Stories per day per audience (last 7 days)
SELECT
  sa.audience_geo,
  DATE_TRUNC('day', sa.created_at) AS day,
  COUNT(*)                          AS story_count
FROM story_audiences sa
WHERE sa.created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2
ORDER BY 2 DESC, 1;

-- 9.5 Rank-bucket distribution per audience (sanity check)
-- hero count should be meaningfully lower than standard
SELECT
  audience_geo,
  rank_bucket,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY audience_geo), 1) AS pct
FROM story_audiences
GROUP BY audience_geo, rank_bucket
ORDER BY audience_geo, MIN(rank_priority);

-- 9.6 Processing-contract integrity alert
-- Returns 0 when invariant holds; any non-zero indicates a broken commit point
SELECT COUNT(*) AS broken_contract_count
FROM clusters c
WHERE c.status = 'PROCESSED'
  AND NOT EXISTS (
    SELECT 1 FROM stories s WHERE s.cluster_id = c.id
  );
