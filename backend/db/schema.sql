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
