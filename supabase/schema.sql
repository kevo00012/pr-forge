-- PR Forge cloud backup: database setup for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- Safe to run more than once.
--
-- Each signed-in person can only read and write their own rows (row level security).
-- The app keeps working offline from the phone's copy and syncs these tables when online.

-- One row per person: settings, saved workouts, custom exercises, import history.
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per finished workout. Deleting a workout in the app sets deleted = true
-- (a "tombstone") so the deletion reaches the person's other devices.
create table if not exists public.workouts (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists workouts_user_updated on public.workouts (user_id, updated_at);

alter table public.profiles enable row level security;
alter table public.workouts enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own workouts" on public.workouts;
create policy "own workouts" on public.workouts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Let signed-in users reach these tables through the Data API (row level security above
-- still limits them to their own rows). Signed-out visitors (anon) get no access at all.
-- Needed when "Automatically expose new tables" is turned off in the project settings.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.workouts to authenticated;
revoke all on public.profiles from anon;
revoke all on public.workouts from anon;
