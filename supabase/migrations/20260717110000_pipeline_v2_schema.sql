-- Pipeline v2 (SPEC §6, §8 — map #50 slice #54): schema support for the
-- global-detection pipeline rework. Cron rewiring lands in the sibling
-- migration; this one only adds the columns the pipeline writes.

-- ---------------------------------------------------------------------------
-- movies.trailer_key: the cached YouTube key of the movie's trailer, filled by
-- the daily hydration from append_to_response=videos (zero extra TMDB HTTP —
-- it rides the existing bundle call, exactly like genres). The detail panel
-- (#58) reads this column instead of making a per-view server call, so the
-- TMDB bearer never leaves the pipeline. NULL = no trailer known.
alter table public.movies add column trailer_key text;
