-- Per-user rate limits for the search/follow edge functions (SPEC §3, §11 —
-- map #50 slice #59). A fixed-window counter per (user, action): the edge
-- function (service role) calls check_rate_limit before doing any TMDB work, so
-- hammering is rejected cheaply and no bearer-backed call is spent.

create table public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  primary key (user_id, action)
);

alter table public.rate_limits enable row level security; -- service-role only; no policies.

-- Atomically bump the counter and report whether the call is within the window
-- budget. Resets the window when it has elapsed. Returns true = allowed.
create function public.check_rate_limit(
  p_user uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  allowed boolean;
begin
  insert into public.rate_limits (user_id, action, window_start, count)
    values (p_user, p_action, now(), 1)
  on conflict (user_id, action) do update set
    window_start = case
      when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then now() else rate_limits.window_start end,
    count = case
      when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then 1 else rate_limits.count + 1 end
  returning count <= p_limit into allowed;
  return allowed;
end $$;

grant execute on function public.check_rate_limit(uuid, text, integer, integer) to service_role;
