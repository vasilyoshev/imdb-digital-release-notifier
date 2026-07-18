-- Movie ratings (2026-07-18 feature request): show a score + vote count in the
-- table and let users filter out low-popularity titles. TMDB's rating/votes/
-- popularity come free with the existing hydration bundle; the true IMDb rating +
-- votes come from OMDb (by imdb id, when OMDB_API_KEY is configured). All NULL
-- until the next hydration fills them.
alter table public.movies
  add column tmdb_rating real,
  add column tmdb_votes integer,
  add column popularity real,
  add column imdb_rating real,
  add column imdb_votes integer;
