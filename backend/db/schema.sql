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
  name         text,
  age          int,
  streak       int default 0,
  last_played  date,
  total_points int default 0,
  tier         text default 'free', -- 'free' | 'premium'
  created_at   timestamptz default now()
);

-- Migration: add name/age if table already exists
alter table users add column if not exists name text;
alter table users add column if not exists age  int;

-- Daily questions cache (fallback if Redis unavailable)
create table if not exists daily_questions (
  date           date primary key,
  questions      jsonb not null,
  generated_at   timestamptz default now()
);

-- Completions — one row per user per session (session_index 0–9)
-- user_id is null for anonymous first session
create table if not exists completions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id),
  date          date not null,
  session_index int not null default 0,
  score         int not null,
  results       jsonb not null,
  created_at    timestamptz default now(),
  unique(user_id, date, session_index)
);

-- Migration: update completions if table already exists
alter table completions add column if not exists session_index int not null default 0;
alter table completions drop constraint if exists completions_user_id_date_key;
alter table completions add constraint if not exists completions_user_id_date_session_key
  unique (user_id, date, session_index);

-- Per-user daily progress (sessions completed + cumulative daily score)
create table if not exists user_daily_progress (
  user_id            uuid references users(id),
  date               date not null,
  sessions_completed int default 0,
  total_score        int default 0,
  primary key (user_id, date)
);
