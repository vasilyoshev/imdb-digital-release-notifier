-- Movie detail panel (SPEC §10 — map #50 slice #58): the panel shows a synopsis,
-- which the pipeline didn't cache. Add it; hydration fills it from the same
-- bundle call (zero extra TMDB HTTP, like genres/trailer_key). NULL = unknown.
alter table public.movies add column overview text;
