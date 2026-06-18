-- Lifetime cumulative quiz stats on users.
--
-- The user-facing score/accuracy/answered display is cumulative and never
-- resets (it's the single source of truth — no per-session score). total_points
-- already tracks lifetime score. These two columns denormalize the lifetime
-- "answered" and "correct" counts for cheap single-row reads on app load; the
-- authoritative source remains user_question_attempts (one idempotent row per
-- attempted question), and POST /api/complete recomputes + rewrites these on
-- every completion so they can't drift.
--
-- "Answered" excludes skips: a skipped question is recorded with delta = 0
-- (correct/wrong answers always have a non-zero wager delta), so answered is
-- count(*) where delta <> 0, and accuracy = total_correct / total_answered.

alter table users add column if not exists total_answered int not null default 0;
alter table users add column if not exists total_correct  int not null default 0;

-- Backfill from the attempt ledger so existing users keep their history.
update users u set
  total_answered = sub.answered,
  total_correct  = sub.correct
from (
  select user_id,
         count(*) filter (where delta <> 0) as answered,
         count(*) filter (where correct)    as correct
  from user_question_attempts
  group by user_id
) sub
where sub.user_id = u.id;
