-- v2 multi-tenant cutover (SPEC §7, §13, §17 — map #50 slice #52).
-- Global detection data becomes anon-readable; user data gets owner columns;
-- notification_log splits into movie_events (detection) + notification_deliveries
-- (per-user delivery). Runs on prod (owner exists) and on a fresh local reset
-- (no users yet) — the DO blocks branch on that.

-- ---------------------------------------------------------------------------
-- 1. Supported Regions: the curated app-level set (SPEC §4). Global, anon-read.
create table public.supported_regions (
  region text primary key,
  name text not null,
  position integer not null
);

insert into public.supported_regions (region, name, position) values
  ('US', 'United States', 0),
  ('GB', 'United Kingdom', 1),
  ('BG', 'Bulgaria', 2),
  ('DE', 'Germany', 3),
  ('FR', 'France', 4),
  ('ES', 'Spain', 5),
  ('IT', 'Italy', 6),
  ('NL', 'Netherlands', 7),
  ('PL', 'Poland', 8),
  ('SE', 'Sweden', 9),
  ('NO', 'Norway', 10),
  ('DK', 'Denmark', 11),
  ('FI', 'Finland', 12),
  ('CA', 'Canada', 13),
  ('AU', 'Australia', 14),
  ('BR', 'Brazil', 15),
  ('MX', 'Mexico', 16),
  ('JP', 'Japan', 17);

-- ---------------------------------------------------------------------------
-- 2. Profiles: role rides on a per-user row, written only by service role.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'user')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. movie_events: the global append-only event stream (detection half of
--    notification_log). seeded = past fact at first observation — dedupe state,
--    never delivered, hidden from history.
create table public.movie_events (
  id bigint generated always as identity primary key,
  movie_id bigint not null references public.movies (id),
  medium text not null check (medium in ('theatrical', 'digital')),
  event text not null check (event in ('announced', 'released', 'date_changed')),
  effective_date date not null,
  seeded boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index movie_events_once_ever
  on public.movie_events (movie_id, medium, event) where event <> 'date_changed';
create index movie_events_by_movie
  on public.movie_events (movie_id, medium, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. radar_entries: cron-computed Digital Release Radar rows. "window" is a
--    reserved word — always quote it.
create table public.radar_entries (
  region text not null references public.supported_regions (region),
  "window" text not null check ("window" in ('recent', 'upcoming')),
  movie_id bigint not null references public.movies (id) on delete cascade,
  rank integer not null,
  digital_date date not null,
  primary key (region, "window", movie_id)
);
create index radar_entries_by_rank on public.radar_entries (region, "window", rank);

-- ---------------------------------------------------------------------------
-- 5. notification_deliveries: the per-user delivery half of notification_log.
create table public.notification_deliveries (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id bigint not null references public.movie_events (id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  sent_at timestamptz not null default now(),
  primary key (user_id, event_id, channel)
);

-- ---------------------------------------------------------------------------
-- 6. movies: genres (table filters / detail / Stremio) + refreshed_at (the
--    shared-cache dedupe key; NULL = never hydrated under v2 = stale).
alter table public.movies add column genres text[];
alter table public.movies add column refreshed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 7. refresh_runs: which job a run was, whose user_refresh it was, and the
--    hydration-quota carryover. Runs are kept forever, so user_id detaches on
--    account deletion rather than cascading.
alter table public.refresh_runs
  add column job text not null default 'full'
    check (job in ('full', 'tick', 'delivery', 'user_refresh')),
  add column user_id uuid references auth.users (id) on delete set null,
  add column movies_deferred integer;

-- ---------------------------------------------------------------------------
-- 8. lists: per-user; the Popular (tmdb_discover) list dies — the Radar
--    replaces it. Memberships cascade; shared movie rows stay.
delete from public.lists where kind = 'tmdb_discover';
alter table public.lists drop constraint lists_kind_check;
alter table public.lists add constraint lists_kind_check
  check (kind in ('imdb_watchlist', 'manual'));
alter table public.lists
  add column user_id uuid references auth.users (id) on delete cascade;
create index lists_by_user on public.lists (user_id);

-- ---------------------------------------------------------------------------
-- 9. settings: singleton → per-user row; region_order → region_cascade
--    (ordered subset of the supported set); gains an IANA timezone.
alter table public.settings rename column region_order to region_cascade;
alter table public.settings add column timezone text not null default 'UTC';
alter table public.settings
  add column user_id uuid references auth.users (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 10. push_subscriptions: per-user.
alter table public.push_subscriptions
  add column user_id uuid references auth.users (id) on delete cascade;
create index push_subscriptions_by_user on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- 11. Owner backfill — or, on a fresh environment with no account, drop the v1
--     seed rows (the signup trigger provisions per-user rows from here on).
do $$
declare
  owner_id uuid;
begin
  select id into owner_id from auth.users order by created_at limit 1;
  if owner_id is null then
    delete from public.push_subscriptions;
    delete from public.lists;
    delete from public.settings;
  else
    insert into public.profiles (user_id, role) values (owner_id, 'owner');
    update public.settings set user_id = owner_id, timezone = 'Europe/Sofia';
    update public.lists set user_id = owner_id;
    update public.push_subscriptions set user_id = owner_id;
    -- Every user has a Followed list (SPEC §5b); the owner gets theirs here.
    insert into public.lists (user_id, kind, name, position)
      values (owner_id, 'manual', 'Followed',
              coalesce((select max(position) + 1 from public.lists), 0));
  end if;
end $$;

alter table public.settings alter column user_id set not null;
alter table public.lists alter column user_id set not null;
alter table public.push_subscriptions alter column user_id set not null;

alter table public.settings drop constraint settings_pkey;
alter table public.settings drop column id;
alter table public.settings add primary key (user_id);

-- ---------------------------------------------------------------------------
-- 12. Split notification_log: every row is a Movie Event (v1 silent rows →
--     seeded), every sent row is additionally an owner Delivery. v1 sent one
--     digest-driven batch per event, so migrated deliveries carry channel
--     'email'. Counts are verified before the table drops.
alter table public.movie_events add column legacy_log_id bigint;

insert into public.movie_events
  (movie_id, medium, event, effective_date, seeded, created_at, legacy_log_id)
select movie_id, medium, event, effective_date, (sent_at is null), created_at, id
from public.notification_log
order by id;

insert into public.notification_deliveries (user_id, event_id, channel, sent_at)
select p.user_id, e.id, 'email', l.sent_at
from public.notification_log l
join public.movie_events e on e.legacy_log_id = l.id
cross join (select user_id from public.profiles where role = 'owner') p
where l.sent_at is not null;

do $$
declare
  log_count bigint;
  moved bigint;
  sent_count bigint;
  delivered bigint;
begin
  select count(*) into log_count from public.notification_log;
  select count(*) into moved from public.movie_events where legacy_log_id is not null;
  if log_count <> moved then
    raise exception 'notification_log split mismatch: % log rows, % movie_events', log_count, moved;
  end if;
  select count(*) into sent_count from public.notification_log where sent_at is not null;
  select count(*) into delivered from public.notification_deliveries;
  if sent_count <> delivered then
    raise exception 'delivery split mismatch: % sent rows, % deliveries', sent_count, delivered;
  end if;
end $$;

alter table public.movie_events drop column legacy_log_id;
drop table public.notification_log;

-- ---------------------------------------------------------------------------
-- 13. Signup provisioning: profile + Followed list + settings row per new auth
--     user. The first user ever becomes the owner — on prod the owner already
--     exists (backfilled above), so real signups always land as 'user'; on a
--     fresh local stack this reproduces prod's owner state.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, role)
  values (new.id,
          case when exists (select 1 from public.profiles) then 'user' else 'owner' end);
  insert into public.lists (user_id, kind, name, position)
  values (new.id, 'manual', 'Followed', 0);
  insert into public.settings (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 14. is_owner(): security definer so policies can consult profiles without
--     recursive-RLS surprises.
create function public.is_owner() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'owner') $$;

-- ---------------------------------------------------------------------------
-- 15. RLS v2 (SPEC §13). The v1 `to authenticated using (true)` policies die.
drop policy movies_select on public.movies;
drop policy lists_select on public.lists;
drop policy lists_update on public.lists;
drop policy memberships_select on public.list_memberships;
drop policy release_dates_select on public.release_dates;
drop policy providers_select on public.watch_providers;
drop policy runs_select on public.refresh_runs;
drop policy settings_select on public.settings;
drop policy settings_update on public.settings;
drop policy push_select on public.push_subscriptions;
drop policy push_insert on public.push_subscriptions;
drop policy push_delete on public.push_subscriptions;

alter table public.supported_regions enable row level security;
alter table public.profiles enable row level security;
alter table public.movie_events enable row level security;
alter table public.radar_entries enable row level security;
alter table public.notification_deliveries enable row level security;

-- Global tables: world-readable, service-role-written.
create policy movies_read on public.movies
  for select to anon, authenticated using (true);
create policy release_dates_read on public.release_dates
  for select to anon, authenticated using (true);
create policy watch_providers_read on public.watch_providers
  for select to anon, authenticated using (true);
create policy movie_events_read on public.movie_events
  for select to anon, authenticated using (true);
create policy radar_entries_read on public.radar_entries
  for select to anon, authenticated using (true);
create policy supported_regions_read on public.supported_regions
  for select to anon, authenticated using (true);

-- profiles: readable by their user, written only by service role.
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- settings: full CRUD on the own row.
create policy settings_select_own on public.settings
  for select to authenticated using (user_id = auth.uid());
create policy settings_insert_own on public.settings
  for insert to authenticated with check (user_id = auth.uid());
create policy settings_update_own on public.settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy settings_delete_own on public.settings
  for delete to authenticated using (user_id = auth.uid());

-- lists: read/update own; create/delete manual only (watchlist lists are
-- provisioned rows, not user-creatable through the API surface).
create policy lists_select_own on public.lists
  for select to authenticated using (user_id = auth.uid());
create policy lists_update_own on public.lists
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy lists_insert_own_manual on public.lists
  for insert to authenticated with check (user_id = auth.uid() and kind = 'manual');
create policy lists_delete_own_manual on public.lists
  for delete to authenticated using (user_id = auth.uid() and kind = 'manual');

-- memberships: through the list's owner; writes only on own manual lists.
create policy memberships_select_own on public.list_memberships
  for select to authenticated using (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid()));
create policy memberships_insert_own_manual on public.list_memberships
  for insert to authenticated with check (
    exists (select 1 from public.lists l
            where l.id = list_id and l.user_id = auth.uid() and l.kind = 'manual'));
create policy memberships_update_own_manual on public.list_memberships
  for update to authenticated using (
    exists (select 1 from public.lists l
            where l.id = list_id and l.user_id = auth.uid() and l.kind = 'manual'))
  with check (
    exists (select 1 from public.lists l
            where l.id = list_id and l.user_id = auth.uid() and l.kind = 'manual'));
create policy memberships_delete_own_manual on public.list_memberships
  for delete to authenticated using (
    exists (select 1 from public.lists l
            where l.id = list_id and l.user_id = auth.uid() and l.kind = 'manual'));

-- push_subscriptions: full CRUD on own rows (upsert needs update).
create policy push_select_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy push_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy push_update_own on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- deliveries: own rows, read-only (pipeline writes).
create policy deliveries_select_own on public.notification_deliveries
  for select to authenticated using (user_id = auth.uid());

-- refresh_runs: owner-only, plus each user's own user_refresh summaries.
create policy runs_select_owner_or_own_refresh on public.refresh_runs
  for select to authenticated using (
    public.is_owner() or (job = 'user_refresh' and user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 16. Base grants. anon gets exactly the global read surface; authenticated
--     gains the new client-side writes (manual lists + memberships). Column-
--     level UPDATE on lists keeps kind/user_id immutable from the client.
grant usage on schema public to anon;
grant select on public.movies, public.release_dates, public.watch_providers,
  public.movie_events, public.radar_entries, public.supported_regions to anon;

grant select on public.supported_regions, public.profiles, public.movie_events,
  public.radar_entries, public.notification_deliveries to authenticated;
grant all privileges on public.supported_regions, public.profiles,
  public.movie_events, public.radar_entries, public.notification_deliveries
  to service_role;

revoke update on public.lists from authenticated;
grant update (name, position, sync_enabled, notifications_enabled, config)
  on public.lists to authenticated;
grant insert, delete on public.lists to authenticated;
grant insert, update, delete on public.list_memberships to authenticated;

-- Sequences created by this migration (movie_events id) — mirror v1's baseline.
grant usage, select on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated;
