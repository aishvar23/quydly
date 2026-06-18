-- Make lifetime score derive from the attempt ledger, like answered/correct.
--
-- total_points was a monotonic running sum (users.total_points + completion
-- score) while total_answered/total_correct were recomputed from
-- user_question_attempts. The two sources drift: the running sum double-counts
-- mid-run beat-switch resubmits and counts legacy id-less completions that never
-- produced ledger rows. Symptom: a user/guest showing e.g. 125 points but
-- 0 answered / 0% accuracy.
--
-- Fix: compute_lifetime_stats also returns points = sum of positive deltas (the
-- same "lifetime score never decreases" rule the client applies via
-- Math.max(0, delta)). applyCompletion writes that instead of the running sum,
-- so all three lifetime stats share one source and can't drift.
--
-- Adding a column to the RETURNS TABLE means the function signature changes, so
-- it must be dropped and recreated (CREATE OR REPLACE can't widen the return
-- type). Safe against already-deployed app code: the old computeLifetimeStats
-- reads only the answered/correct columns and ignores the extra points column.
--
-- Backfill of existing total_points rows is a SEPARATE migration
-- (migration_backfill_lifetime_points.sql) because it rewrites historical
-- scores; this one is non-destructive.

drop function if exists compute_lifetime_stats(uuid);

create function compute_lifetime_stats(p_user uuid)
returns table(answered int, correct int, points int)
language sql
stable
as $$
  select
    count(*) filter (where delta <> 0)::int               as answered,
    count(*) filter (where correct)::int                  as correct,
    coalesce(sum(delta) filter (where delta > 0), 0)::int as points
  from user_question_attempts
  where user_id = p_user;
$$;
