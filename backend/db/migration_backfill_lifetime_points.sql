-- Backfill total_points from the attempt ledger so existing rows match the new
-- ledger-derived score (see migration_lifetime_points_consistency.sql). Without
-- this, a user's total_points only self-heals on their next completion, so the
-- "125 points / 0 answered" rows linger.
--
-- Every user's score becomes the sum of their positive ledger deltas. Users with
-- no ledger rows (legacy id-less completions only) correctly become 0. This
-- rewrites historical scores and is NOT reversible — the old running-sum values
-- are not stored anywhere else. Run deliberately.

update users u set total_points = coalesce((
  select sum(a.delta) filter (where a.delta > 0)::int
  from user_question_attempts a
  where a.user_id = u.id
), 0);
