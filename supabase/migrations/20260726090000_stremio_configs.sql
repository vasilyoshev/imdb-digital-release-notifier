-- Configurable Stremio addon (map #109, ticket #111): per-user addon token +
-- server-side catalog config. The Cloudflare Worker resolves token → catalogs
-- through anon-executable security-definer RPCs — the token grants catalog
-- READS only; edits go through normal auth + RLS on the table. Token is hex so
-- it can never contain "manifest.json" (Stremio's Configure button rewrites
-- the transport URL by replacing that substring — #110).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. stremio_configs: one row per user, created lazily when they first open
--    /configure. config holds per-catalog options keyed by catalog id
--    ("list-<id>", "new-digital", "upcoming-digital"); missing keys mean
--    defaults, so '{}' is a fully valid config.
create table public.stremio_configs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.stremio_configs_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger stremio_configs_touch
  before update on public.stremio_configs
  for each row execute function public.stremio_configs_touch();

-- ---------------------------------------------------------------------------
-- 2. RLS + grants: owner-only CRUD; the token column is server-generated and
--    immutable from the client (no vanity/guessable tokens) — regeneration
--    goes through the RPC below.
alter table public.stremio_configs enable row level security;

create policy stremio_configs_select_own on public.stremio_configs
  for select to authenticated using (user_id = auth.uid());
create policy stremio_configs_insert_own on public.stremio_configs
  for insert to authenticated with check (user_id = auth.uid());
create policy stremio_configs_update_own on public.stremio_configs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy stremio_configs_delete_own on public.stremio_configs
  for delete to authenticated using (user_id = auth.uid());

-- Supabase's default privileges grant ALL on new public tables to anon +
-- authenticated — revoke first, then grant exactly the intended surface
-- (otherwise authenticated could UPDATE its own token to a chosen value).
revoke all on public.stremio_configs from anon, authenticated;
grant select, delete on public.stremio_configs to authenticated;
grant insert (user_id, config) on public.stremio_configs to authenticated;
grant update (config) on public.stremio_configs to authenticated;
grant all privileges on public.stremio_configs to service_role;

-- ---------------------------------------------------------------------------
-- 3. Token regeneration: authenticated-only, definer so it can write the
--    grant-protected token column. Old install keeps working until the row
--    updates; Stremio treats the new URL as a different addon (#110).
create function public.stremio_regenerate_token() returns text
language sql volatile security definer set search_path = public, extensions as
$$
  update public.stremio_configs
  set token = encode(extensions.gen_random_bytes(24), 'hex')
  where user_id = auth.uid()
  returning token
$$;

revoke execute on function public.stremio_regenerate_token() from public;
grant execute on function public.stremio_regenerate_token() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Worker access path (the ticket's real decision): the Worker keeps using
--    only the anon key — no service-role secret in Cloudflare. These two
--    definer RPCs are the entire read surface a token unlocks.

-- Manifest data: the stored config + the user's lists (catalog candidates).
-- Unknown/revoked token → NULL, which the Worker turns into an empty-catalog
-- manifest rather than a 404 (#110: dead installs should fail soft).
create function public.stremio_config_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'config', sc.config,
    'lists', coalesce(
      (select jsonb_agg(
                jsonb_build_object('id', l.id, 'name', l.name, 'kind', l.kind)
                order by l.position, l.id)
       from public.lists l
       where l.user_id = sc.user_id),
      '[]'::jsonb))
  from public.stremio_configs sc
  where sc.token = p_token
$$;

-- One list's rows with everything the Worker's sort/filter/meta needs
-- (fetch-then-sort in the Worker, reusing src/lib logic; lists are small).
-- Wrong token or a list the token's user doesn't own → empty set.
create function public.stremio_list_movies(p_token text, p_list_id integer)
returns table (
  imdb_id text,
  title text,
  year integer,
  poster_path text,
  overview text,
  digital_date date,
  theatrical_date date,
  imdb_rating real,
  imdb_votes integer,
  tmdb_rating real,
  tmdb_votes integer,
  popularity real,
  added_at timestamptz
)
language sql stable security definer set search_path = public as
$$
  select m.imdb_id, m.title, m.year, m.poster_path, m.overview,
         m.digital_date, m.theatrical_date,
         m.imdb_rating, m.imdb_votes, m.tmdb_rating, m.tmdb_votes,
         m.popularity, lm.added_at
  from public.stremio_configs sc
  join public.lists l on l.user_id = sc.user_id and l.id = p_list_id
  join public.list_memberships lm on lm.list_id = l.id and lm.on_list
  join public.movies m on m.id = lm.movie_id
  where sc.token = p_token
$$;

revoke execute on function public.stremio_config_by_token(text) from public;
revoke execute on function public.stremio_list_movies(text, integer) from public;
grant execute on function public.stremio_config_by_token(text)
  to anon, authenticated, service_role;
grant execute on function public.stremio_list_movies(text, integer)
  to anon, authenticated, service_role;
