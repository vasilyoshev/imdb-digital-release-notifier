-- Movies: one row per film ever tracked, never deleted. Identity may arrive
-- from IMDb (watchlist) or TMDb (discover); at least one id present.
create table public.movies (
  id bigint generated always as identity primary key,
  imdb_id text unique,
  tmdb_id integer unique,
  title text,
  year integer,
  poster_path text,
  theatrical_date date,
  theatrical_region text,
  digital_date date,
  digital_region text,
  created_at timestamptz not null default now(),
  first_refreshed_at timestamptz,
  check (imdb_id is not null or tmdb_id is not null)
);

create table public.lists (
  id integer generated always as identity primary key,
  kind text not null check (kind in ('imdb_watchlist','tmdb_discover')),
  name text not null,
  position integer not null default 0,
  sync_enabled boolean not null default true,
  notifications_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.list_memberships (
  list_id integer not null references public.lists(id) on delete cascade,
  movie_id bigint not null references public.movies(id) on delete cascade,
  on_list boolean not null default true,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (list_id, movie_id)
);

create table public.release_dates (
  movie_id bigint not null references public.movies(id) on delete cascade,
  region text not null,
  medium text not null check (medium in ('theatrical','digital')),
  release_date date not null,
  primary key (movie_id, region, medium)
);

create table public.watch_providers (
  movie_id bigint not null references public.movies(id) on delete cascade,
  region text not null,
  provider_id integer not null,
  offer_type text not null check (offer_type in ('flatrate','free','ads','rent','buy')),
  provider_name text not null,
  logo_path text,
  display_priority integer,
  link text,
  primary key (movie_id, region, provider_id, offer_type)
);

-- Append-only; sent_at NULL = seeded/paused/gated-silent. Never pruned.
create table public.notification_log (
  id bigint generated always as identity primary key,
  movie_id bigint not null references public.movies(id),
  medium text not null check (medium in ('theatrical','digital')),
  event text not null check (event in ('announced','released','date_changed')),
  effective_date date not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notification_log_once_ever
  on public.notification_log (movie_id, medium, event) where event <> 'date_changed';
create index notification_log_by_movie
  on public.notification_log (movie_id, medium, created_at desc);

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Singleton (id must be true, PK ⇒ at most one row).
create table public.settings (
  id boolean primary key default true check (id),
  region_order text[] not null default '{BG,US,GB}',
  notify_email text,
  notifications_paused boolean not null default false,
  notify_hour integer not null default 9 check (notify_hour between 0 and 23)
);

create table public.refresh_runs (
  id bigint generated always as identity primary key,
  trigger text not null check (trigger in ('cron','manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','error')),
  movies_total integer,
  movies_matched integer,
  events_created integer,
  notifications_sent integer,
  error text
);

-- Seed
insert into public.settings (id, notify_email) values (true, 'vasil.yoshev@gmail.com');
insert into public.lists (kind, name, position, config) values
  ('imdb_watchlist', 'Watchlist', 0, '{"imdb_user_id": "ur27331503"}'),
  ('tmdb_discover', 'Popular', 1,
   '{"filters": {"sort_by": "popularity.desc", "vote_count.gte": 100}, "limit": 50}');

-- RLS: role-based, no owner columns (single-account model).
-- authenticated: SELECT everything; write only settings, push_subscriptions,
-- and UPDATE lists (toggles + config). Pipeline uses service role (bypasses RLS).
alter table public.movies enable row level security;
alter table public.lists enable row level security;
alter table public.list_memberships enable row level security;
alter table public.release_dates enable row level security;
alter table public.watch_providers enable row level security;
alter table public.notification_log enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.settings enable row level security;
alter table public.refresh_runs enable row level security;

create policy movies_select on public.movies for select to authenticated using (true);
create policy lists_select on public.lists for select to authenticated using (true);
create policy lists_update on public.lists for update to authenticated using (true) with check (true);
create policy memberships_select on public.list_memberships for select to authenticated using (true);
create policy release_dates_select on public.release_dates for select to authenticated using (true);
create policy providers_select on public.watch_providers for select to authenticated using (true);
create policy log_select on public.notification_log for select to authenticated using (true);
create policy runs_select on public.refresh_runs for select to authenticated using (true);
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated using (true) with check (true);
create policy push_select on public.push_subscriptions for select to authenticated using (true);
create policy push_insert on public.push_subscriptions for insert to authenticated with check (true);
create policy push_delete on public.push_subscriptions for delete to authenticated using (true);

-- Base privileges (RLS is the row gate; base grants mirror the spec §10 matrix)
grant usage on schema public to authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on all tables in schema public to authenticated;
grant update on public.lists to authenticated;
grant insert, update, delete on public.settings to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Future tables/sequences created by migrations (as postgres) get the same baseline
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public grant select on tables to authenticated;
alter default privileges for role postgres in schema public grant usage, select on sequences to authenticated;
