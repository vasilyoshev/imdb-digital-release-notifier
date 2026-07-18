-- Open signup (SPEC §3 — map #50 slice #62): onboarding state. New users land
-- un-onboarded and get the 2-step wizard on first sign-in; existing users (the
-- owner) are already set up. The flag is flipped by the `onboard` edge function
-- (service role), which also provisions the user's IMDb watchlist list — clients
-- can't insert a watchlist list under the §13 RLS (manual-only insert policy).
alter table public.profiles add column onboarded boolean not null default false;

-- Existing accounts are already configured — don't re-onboard them.
update public.profiles set onboarded = true;

-- New signups start un-onboarded (column default handles it); the trigger from
-- the v2 migration inserts profiles without touching this column.
