-- Auto-create a public.users row whenever Supabase Auth creates a new user
-- (covers both anonymous sign-ins and Google OAuth upgrades)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  streak       int default 0,
  last_played  date,
  total_points int default 0,
  tier         text default 'free', -- 'free' | 'premium'
  created_at   timestamptz default now()
);

-- Daily questions cache (fallback if Redis unavailable)
create table if not exists daily_questions (
  date           date primary key,
  questions      jsonb not null,
  generated_at   timestamptz default now()
);

-- Per-user daily session progress (tracks how many 5-question sessions completed)
create table if not exists user_daily_progress (
  user_id            uuid references users(id),
  date               date not null,
  sessions_completed int default 0,
  total_score        int default 0,
  primary key (user_id, date)
);

-- Completions
create table if not exists completions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id),
  date       date not null,
  score      int not null,
  results    jsonb not null,
  created_at timestamptz default now(),
  unique(user_id, date)
);

-- Per-question identity (durable backlog for signed-in, unbounded, multi-day play).
-- story_id FK to stories(id) is added in migration_question_identity.sql, where
-- the stories table is guaranteed to exist; kept FK-less here so a fresh apply of
-- this core schema (which does not define stories) succeeds standalone.
create table if not exists quiz_questions (
  id            uuid        primary key default gen_random_uuid(),
  date          date        not null,
  audience      text        not null default 'global',
  category_id   text        not null,
  question      text        not null,
  options       jsonb       not null,
  correct_index int         not null check (correct_index between 0 and 3),
  tldr          text        not null,
  story_id      bigint,
  created_at    timestamptz not null default now()
);
create index if not exists quiz_questions_serve_idx
  on quiz_questions (audience, date desc, category_id);
create index if not exists quiz_questions_beat_idx
  on quiz_questions (audience, category_id, date desc);

-- Per-user attempt checkpoint: the set of question ids a user has attempted.
create table if not exists user_question_attempts (
  user_id      uuid        not null references users(id) on delete cascade,
  question_id  uuid        not null references quiz_questions(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  correct      boolean,
  delta        int,
  primary key (user_id, question_id)
);
create index if not exists uqa_user_idx on user_question_attempts (user_id);
