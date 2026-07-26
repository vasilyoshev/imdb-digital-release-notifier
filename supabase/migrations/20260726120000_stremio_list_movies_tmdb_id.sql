-- #112 follow-up to 20260726090000: the Worker derives the status ladder
-- (statusOf) for the addon's status filter, and that needs tmdb_id to tell
-- "Unmatched" from "Waiting". Return type changes → drop + recreate (execute
-- grants don't survive the drop).
drop function public.stremio_list_movies(text, integer);

create function public.stremio_list_movies(p_token text, p_list_id integer)
returns table (
  imdb_id text,
  tmdb_id integer,
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
  select m.imdb_id, m.tmdb_id, m.title, m.year, m.poster_path, m.overview,
         m.digital_date, m.theatrical_date,
         m.imdb_rating, m.imdb_votes, m.tmdb_rating, m.tmdb_votes,
         m.popularity, lm.added_at
  from public.stremio_configs sc
  join public.lists l on l.user_id = sc.user_id and l.id = p_list_id
  join public.list_memberships lm on lm.list_id = l.id and lm.on_list
  join public.movies m on m.id = lm.movie_id
  where sc.token = p_token
$$;

revoke execute on function public.stremio_list_movies(text, integer) from public;
grant execute on function public.stremio_list_movies(text, integer)
  to anon, authenticated, service_role;
