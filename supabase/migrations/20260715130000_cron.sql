create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The job reads its target URL + key from Vault so the same migration works
-- on local and self-hosted stacks. Seed per environment:
--   select vault.create_secret('<edge functions base url>', 'project_url');
--   select vault.create_secret('<service role key>', 'service_role_key');
select cron.schedule(
  'refresh-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
