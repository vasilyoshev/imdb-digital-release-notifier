-- Delivery job cron (SPEC §8 job 3, §14 — map #50 slice #56). The hourly
-- delivery job gates per user on their local gate hour inside the function, so
-- it simply fires every hour; a row update to a user's timezone/notify_hour
-- needs no cron surgery. The #54 owner-delivery shim inside the tick is gone —
-- delivery is now this job's sole concern. Reuses the Vault secrets.

select cron.schedule(
  'refresh-delivery-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"job":"delivery"}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
