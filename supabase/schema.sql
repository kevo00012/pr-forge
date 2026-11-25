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

-- The server stamps updated_at on every write, so phones with wrong clocks can't confuse syncing.
create or replace function public.prf_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.prf_touch_updated_at();

drop trigger if exists workouts_touch on public.workouts;
create trigger workouts_touch before insert or update on public.workouts
  for each row execute function public.prf_touch_updated_at();

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

-- ---------------------------------------------------------------------------------------------
-- Sign-in handover (app 1.6.3). On iPhone, Google sign-in from the home-screen app can finish in a
-- browser sheet with its own storage. The app sends a one-time random secret (nonce) along; the sheet
-- stores the new sign-in under it here, and the app collects it once, within 5 minutes.
-- Nobody can read this table directly: only these two functions touch it.
create table if not exists public.signin_handoffs (
  nonce         text primary key check (length(nonce) >= 32),
  refresh_token text not null,
  created_at    timestamptz not null default now()
);
alter table public.signin_handoffs enable row level security;
revoke all on public.signin_handoffs from anon, authenticated;

-- Called by the browser sheet, signed in as the person.
create or replace function public.prf_handoff_put(p_nonce text, p_refresh text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_nonce is null or length(p_nonce) < 32 then raise exception 'bad handover code'; end if;
  delete from public.signin_handoffs where created_at < now() - interval '10 minutes';
  insert into public.signin_handoffs (nonce, refresh_token) values (p_nonce, p_refresh)
    on conflict (nonce) do nothing;
end;
$$;

-- Called by the app before it's signed in. Returns the sign-in once, then it's gone.
create or replace function public.prf_handoff_take(p_nonce text) returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  delete from public.signin_handoffs
    where nonce = p_nonce and created_at > now() - interval '5 minutes'
    returning refresh_token into t;
  return t;
end;
$$;

revoke all on function public.prf_handoff_put(text, text) from public, anon;
grant execute on function public.prf_handoff_put(text, text) to authenticated;
revoke all on function public.prf_handoff_take(text) from public;
grant execute on function public.prf_handoff_take(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Routine share codes (app 2.8.0). "Share with a friend → Get a share code" stores a copy of one routine here under
-- a 6-character code (no 0/O/1/I). Anyone with the code can read that routine for 30 days, then it's deleted.
-- Nobody can read or list this table directly: only the two functions below touch it.
-- After running this, also run:  notify pgrst, 'reload schema';
create table if not exists public.routine_shares (
  code       text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  owner      uuid not null references auth.users (id) on delete cascade,
  routine    jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.routine_shares enable row level security;
revoke all on public.routine_shares from anon, authenticated;

-- Called by a signed-in person: saves a routine and returns its new code.
create or replace function public.prf_share_put(p_routine jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  tries int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_routine is null or octet_length(p_routine::text) > 20000 then raise exception 'routine too large'; end if;
  delete from public.routine_shares where created_at < now() - interval '30 days';
  if (select count(*) from public.routine_shares where owner = auth.uid()) >= 50 then raise exception 'too many share codes'; end if;
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    begin
      insert into public.routine_shares (code, owner, routine) values (c, auth.uid(), p_routine);
      return c;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- Called by anyone with a code: returns that routine (or null when the code is unknown or older than 30 days).
create or replace function public.prf_share_get(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select routine from public.routine_shares
  where code = upper(trim(p_code)) and created_at > now() - interval '30 days';
$$;

revoke all on function public.prf_share_put(jsonb) from public, anon;
grant execute on function public.prf_share_put(jsonb) to authenticated;
revoke all on function public.prf_share_get(text) from public;
grant execute on function public.prf_share_get(text) to anon, authenticated;
