-- Pipeline v2 cron rewire (SPEC §8, §14 — map #50 slice #54). The v1 single
-- "refresh-hourly" job gated the whole run on the owner's gate hour; v2 splits
-- into a daily full refresh and an hourly change tick, each selected by a `job`
-- discriminator in the POST body. The old per-run gate-hour check dies here;
-- per-user delivery gating moves into the tick (owner shim) and, later, the
-- dedicated delivery job (#56). Vault secrets project_url + service_role_key are
-- reused unchanged.

select cron.unschedule('refresh-hourly');

-- Daily full refresh: sync all lists, hydrate the movie union, detect events.
-- 03:00 UTC — off-peak; the run time is arbitrary (delivery no longer rides it).
select cron.schedule(
  'refresh-full-daily',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"job":"full"}'::jsonb,
    timeout_milliseconds := 600000
  );
  $$
);

-- Hourly change tick: re-hydrate TMDb-reported changes; the tick also runs the
-- owner-delivery shim when the owner's local gate hour is now.
select cron.schedule(
  'refresh-tick-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"job":"tick"}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
