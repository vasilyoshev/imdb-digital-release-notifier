# Coolify's Supabase service: what it deploys, and whether it covers Edge Functions + pg_cron (second pass)

> **Note:** this is an independent second research pass on issue #13, run concurrently with
> [`coolify-supabase.md`](./coolify-supabase.md) (the first pass, whose resolution comment closed the
> issue). The two passes agree on essentially all facts — template contents, version drift, extension
> preloading, verify_jwt semantics, arm64, the #7528 backup compatibility table — but reach **opposite
> recommendations**. The divergence hinges on evidence the first pass did not surface: open Coolify bug
> [#10903](https://github.com/coollabsio/coolify/issues/10903) (2026-07-10), where the template's
> `content:` bind-mount mechanism — the very mechanism the first pass recommends for deploying the
> `refresh` function — materializes `functions/main/index.ts` as a *directory* and boot-loops
> edge-runtime on fresh deploys; plus the redeploy secret-drift issue class (#8920, #8863, #2696) and
> upstream making the heavy Logflare/Vector pair opt-in while the template force-bundles old versions.
> Since #7528 grants backup support to *empty* (pasted) compose resources just as it does to one-click
> services, the backup argument does not favor the template. Hence this pass recommends the official
> compose as an empty Coolify resource.

**TL;DR — Recommendation: skip Coolify's one-click Supabase template and run the official `supabase/docker` compose as a Coolify "Docker Compose (empty)" resource.** The one-click template does ship every service we need — including `supabase/edge-runtime` with the `main` router pre-wired and a Postgres image that bundles pg_cron + pg_net + supabase_vault — but it lags upstream badly (Postgres **15.8** vs upstream **17.6**, Studio from **2026-03** vs **2026-07**), still force-bundles the memory-hungry Logflare/Vector analytics pair that upstream made opt-in in June 2026, has an **open** bug where Coolify's file-content mounts materialize `functions/main/index.ts` as a *directory* and put edge-runtime in a boot loop ([#10903](https://github.com/coollabsio/coolify/issues/10903)), and a history of redeploy credential breakage. The official compose gives us upstream-current images, a lean stack (no analytics by default), full control of `volumes/functions/refresh/index.ts`, direct env-var secret injection (`TMDB_BEARER`), and — per Coolify's own compatibility table — still gets Coolify's scheduled S3 Postgres backups, which apply to "Empty Docker Compose" resources but *not* git-sourced compose ([coollabsio/coolify#7528](https://github.com/coollabsio/coolify/issues/7528)). `supabase functions deploy` does not target self-hosted; the deploy flow is "write file into `volumes/functions/<name>/index.ts`, restart the functions container" ([self-hosting docs](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/docker.mdx)). pg_cron→pg_net→Vault scheduling works exactly as on the platform once you run `create extension pg_cron;` (pg_net is created by the stock init scripts; all three are in `shared_preload_libraries`).

- **Date:** 2026-07-15
- **Research question:** What exactly does Coolify's Supabase service deploy — and does it cover Edge Functions + pg_cron? (GitHub issue #13, vasilyoshev/imdb-digital-release-notifier)
- **Method:** primary sources only — raw files from `coollabsio/coolify` and `supabase/*` GitHub repos, supabase.com docs, coolify.io docs, Docker Hub tags API, GitHub issues API.

---

## 1. What the Coolify template deploys vs the official compose

### Coolify template — [`templates/compose/supabase.yaml` @ main](https://raw.githubusercontent.com/coollabsio/coolify/main/templates/compose/supabase.yaml)

Template header: `# port: 8000` (Kong is the only proxied entrypoint). Services and exact image tags as of 2026-07-15:

| Service | Image:tag |
|---|---|
| supabase-kong | `kong/kong:3.9.1` |
| supabase-studio | `supabase/studio:2026.03.16-sha-5528817` |
| supabase-db | `supabase/postgres:15.8.1.085` |
| supabase-analytics | `supabase/logflare:1.31.2` |
| supabase-vector | `timberio/vector:0.53.0-alpine` |
| supabase-rest | `postgrest/postgrest:v14.6` |
| supabase-auth | `supabase/gotrue:v2.186.0` |
| realtime-dev | `supabase/realtime:v2.76.5` |
| supabase-storage | `supabase/storage-api:v1.44.2` |
| supabase-minio | `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` |
| minio-createbucket | `minio/mc` |
| imgproxy | `darthsim/imgproxy:v3.30.1` |
| supabase-meta | `supabase/postgres-meta:v0.95.2` |
| supabase-edge-functions | `supabase/edge-runtime:v1.71.2` |
| supabase-supavisor | `supabase/supavisor:2.7.4` |

So yes — the template **does include the edge-runtime (functions) service**, plus analytics (Logflare), vector, and supavisor. It **adds** MinIO (storage uses `STORAGE_BACKEND=s3` → `STORAGE_S3_ENDPOINT=http://supabase-minio:9000`), which upstream does not ship. Anon/service keys are Coolify "magic" variables `SERVICE_SUPABASEANON_KEY` / `SERVICE_SUPABASESERVICE_KEY`: Coolify's [`bootstrap/helpers/shared.php`](https://raw.githubusercontent.com/coollabsio/coolify/main/bootstrap/helpers/shared.php) special-cases these names in `generateEnvValue()` and mints real HS256 JWTs (`role: anon` / `role: service_role`, issuer `supabase`, +100-year expiry) signed with the generated `SERVICE_PASSWORD_JWT` secret.

### Official compose — [`docker/docker-compose.yml` @ supabase/supabase master](https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml)

| Service | Image:tag |
|---|---|
| studio | `supabase/studio:2026.07.07-sha-a6a04f2` |
| kong | `kong/kong:3.9.1` |
| auth | `supabase/gotrue:v2.189.0` |
| rest | `postgrest/postgrest:v14.12` |
| realtime | `supabase/realtime:v2.102.3` |
| storage | `supabase/storage-api:v1.60.4` |
| imgproxy | `darthsim/imgproxy:v3.30.1` |
| meta | `supabase/postgres-meta:v0.96.6` |
| functions | `supabase/edge-runtime:v1.74.0` |
| db | `supabase/postgres:17.6.1.136` |
| supavisor | `supabase/supavisor:2.9.5` |

**Analytics/vector are no longer in the base compose.** They moved to an opt-in overlay, [`docker/docker-compose.logs.yml`](https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.logs.yml) (`supabase/logflare:1.43.1` + `timberio/vector:0.53.0-alpine`), enabled via `sh run.sh config add logs && sh run.sh start`; the base compose sets `ENABLED_FEATURES_LOGS_ALL: "false"` on Studio ([self-hosting docker guide](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/docker.mdx)).

### Gap summary (Coolify template vs upstream)

- **Postgres major version drift: 15.8.1.085 vs 17.6.1.136** — the biggest gap; template staleness was itself a filed bug ([#9953 "supabase template outdated massively"](https://github.com/coollabsio/coolify/issues/9953), closed by a version-bump PR, and it has drifted again since).
- Coolify still bundles Logflare 1.31.2 + Vector in the main stack (upstream made them opt-in and newer).
- Coolify adds MinIO for storage (upstream uses a file backend by default).
- Every upstream service tag is newer (edge-runtime v1.71.2 vs v1.74.0, realtime v2.76.5 vs v2.102.3, storage v1.44.2 vs v1.60.4, etc.).
- Nothing we need is *missing* from the template — the gap is drift + template-mechanics bugs, not coverage.

## 2. Edge Functions on self-hosted

**How the runtime finds functions.** The `functions` service runs `supabase/edge-runtime` with `command: ["start", "--main-service", "/home/deno/functions/main"]` and mounts `./volumes/functions:/home/deno/functions:z` ([docker-compose.yml](https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml)). The `main` entrypoint ([`docker/volumes/functions/main/index.ts`](https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes/functions/main/index.ts)) is a router: it takes the first path segment (`const service_name = path_parts[1]`, 400 if missing), maps it to `servicePath = /home/deno/functions/${service_name}`, and spawns a user worker via `EdgeRuntime.userWorkers.create` with hardcoded `memoryLimitMb = 150` and `workerTimeoutMs = 60_000`, forwarding **all of the container's env vars** to the worker (`envVars = Object.keys(envVarsObj).map(...)`). So `GET/POST {kong}/functions/v1/refresh` executes `/home/deno/functions/refresh/index.ts`.

**Env vars available to functions** (set on the container in the official compose): `JWT_SECRET`, `SUPABASE_URL=http://kong:8000`, `SUPABASE_PUBLIC_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL=postgresql://postgres:...@db:5432/postgres`, `VERIFY_JWT="${FUNCTIONS_VERIFY_JWT}"` ([compose](https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml)). Because main forwards the entire environment, **injecting `TMDB_BEARER` is just adding an env var to the `functions` service** (in Coolify: an env var in the resource's Environment Variables UI referenced from the compose) and reading `Deno.env.get('TMDB_BEARER')`. No Vault involvement needed on the functions side.

**verify_jwt on self-hosted** is a *global* switch, not per-function: `main/index.ts` checks `if (req.method !== 'OPTIONS' && VERIFY_JWT)` and verifies the `Authorization` bearer token — HS256 against `JWT_SECRET`, ES256/RS256 against `SUPABASE_JWKS` ([main/index.ts](https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes/functions/main/index.ts)). Default is `FUNCTIONS_VERIFY_JWT=false` in both [upstream `.env.example`](https://raw.githubusercontent.com/supabase/supabase/master/docker/.env.example) and the Coolify template (`VERIFY_JWT=${FUNCTIONS_VERIFY_JWT:-false}`). The per-function `verify_jwt` in `config.toml` is a CLI/platform concept and has no effect here.

**Deploy/redeploy flow.** The self-hosting guide's documented flow: put code at `volumes/functions/<FUNCTION_NAME>/index.ts`, then `sh run.sh restart functions`; "the main worker loads each function from disk per request" ([docker.mdx](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/docker.mdx)). `supabase functions deploy` is documented as "Deploy a Function to the **linked Supabase project**" with a `--project-ref` flag and no self-hosted target ([CLI reference](https://supabase.com/docs/reference/cli/supabase-functions-deploy)) — confirmed not usable against self-hosted; users asking how to deploy to Coolify-hosted Supabase are told to use the volume ([coolify discussion #5983](https://github.com/coollabsio/coolify/discussions/5983)).

**Coolify template specifics.** The template does include the service and *embeds* `main/index.ts` (the JWT-checking router, jose-based) and a `hello` example as inline `content:` blocks on bind mounts targeting `/home/deno/functions/...` ([template](https://raw.githubusercontent.com/coollabsio/coolify/main/templates/compose/supabase.yaml)). But that mechanism is exactly what's broken in the **open** bug [#10903](https://github.com/coollabsio/coolify/issues/10903) (2026-07-10, Coolify 4.1.2): the content mount materializes `functions/main/index.ts` as a **directory**, edge-runtime "failed to determine entrypoint" and restart-loops; the workaround is SSH-ing in and replacing the directory with a real file. Same failure class as the earlier [#8632](https://github.com/coollabsio/coolify/issues/8632) ("Is a directory (os error 21)"). A community PR adding a `/deploy` endpoint for dynamic per-function deployment ([#6602](https://github.com/coollabsio/coolify/pull/6602)) was **rejected**: "Supabase is already a very complex service to maintain… I do not think it makes sense to add this." So on Coolify, either way, deploying `refresh` means writing the file into the service's `volumes/functions/` directory on the server and restarting the functions container — the template gives no better mechanism.

## 3. pg_cron / pg_net / Vault in `supabase/postgres`

- **Bundled:** the [supabase/postgres README](https://github.com/supabase/postgres) lists `pg_cron` 1.6.4, `pg_net` (0.8.0 on PG15, 0.19.5 on PG17), `vault` 0.3.1 ("Store encrypted secrets in PostgreSQL"), plus `pgjwt` and `pgsodium` 3.1.8 — in both the PG15 image (Coolify) and PG17 image (upstream).
- **Preloaded:** the image's postgresql.conf template sets `shared_preload_libraries = 'pg_stat_statements, pgaudit, plpgsql, plpgsql_check, pg_cron, pg_net, pgsodium, timescaledb, auto_explain, pg_tle, plan_filter, supabase_vault'` ([ansible/files/postgresql_config/postgresql.conf.j2](https://raw.githubusercontent.com/supabase/postgres/develop/ansible/files/postgresql_config/postgresql.conf.j2)); the compose runs the db with `-c config_file=/etc/postgresql/postgresql.conf`, i.e. that baked-in config. No restart is ever needed to enable these.
- **Created by default?** Partially. The image's initial schema only does `create extension if not exists "uuid-ossp" / pgcrypto` ([initial-schema.sql](https://raw.githubusercontent.com/supabase/postgres/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql)). The compose's init script `webhooks.sql` runs `CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;` ([docker/volumes/db/webhooks.sql](https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes/db/webhooks.sql)) — and the Coolify template embeds the same webhooks/roles/jwt/realtime/logs/pooler init SQL inline, so **pg_net is created on first boot in both setups**. **pg_cron is NOT created by default** — one `create extension pg_cron;` (as superuser, in the `postgres` DB) is required. **supabase_vault** likewise needs `create extension supabase_vault cascade;` unless already present.
- **Vault on self-hosted:** yes — [supabase/vault](https://github.com/supabase/vault) is an open-source Postgres extension (`CREATE EXTENSION supabase_vault CASCADE`) providing `vault.create_secret()`, `vault.update_secret()`, and the `vault.decrypted_secrets` view; it is bundled in the image and preloaded per the two sources above.

## 4. Migrations against self-hosted

- `supabase db push` supports `--db-url` — "Pushes to the database specified by the connection string (must be percent-encoded)" — alongside `--linked`/`--local`, and maintains history in `supabase_migrations.schema_migrations` ([CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push)). So `supabase db push --db-url 'postgresql://postgres.<tenant>:<pw>@host:5432/postgres'` works against a self-hosted stack; plain `psql -f` is the trivial fallback.
- **Ports:** in the official compose the `db` container publishes nothing; **Supavisor** publishes `${POSTGRES_PORT}:5432` (session mode) and `${POOLER_PROXY_PORT_TRANSACTION}:6543` (transaction mode) ([compose](https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml)), defaults `5432`/`6543` with `POOLER_TENANT_ID=your-tenant-id` ([.env.example](https://raw.githubusercontent.com/supabase/supabase/master/docker/.env.example)); the docs give `psql 'postgres://postgres.[POOLER_TENANT_ID]:[POSTGRES_PASSWORD]@[your-domain]:5432/postgres'` for session mode ([docker.mdx](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/docker.mdx)). Use the **session** port (5432) for migrations.
- **Coolify template exposes no DB port at all** — neither `supabase-db` nor `supabase-supavisor` has a `ports:` section ([template](https://raw.githubusercontent.com/coollabsio/coolify/main/templates/compose/supabase.yaml)); Coolify's own docs admit "There is a bug with making database publicly accessible" and describe a manual compose-edit + firewall workaround ([coolify.io/docs/services/supabase](https://coolify.io/docs/services/supabase)). With the official compose as a Coolify resource, the supavisor port mappings are already in the file.

## 5. arm64 availability

Checked via the Docker Hub tags API (`hub.docker.com/v2/repositories/<repo>/tags/<tag>`) on 2026-07-15 — **every image in both stacks publishes amd64 + arm64** ("unknown" entries are attestation manifests):

| Image:tag | Architectures |
|---|---|
| supabase/postgres:17.6.1.136 and :15.8.1.085 | amd64, arm64 |
| supabase/studio:2026.07.07-sha-a6a04f2 | amd64, arm64 |
| kong/kong:3.9.1 | amd64, arm64 |
| supabase/gotrue:v2.189.0 | amd64, arm64 |
| postgrest/postgrest:v14.12 | amd64, arm64 |
| supabase/realtime:v2.102.3 | amd64, arm64 |
| supabase/storage-api:v1.60.4 | amd64, arm64 |
| supabase/postgres-meta:v0.96.6 | amd64, arm64 |
| supabase/edge-runtime:v1.74.0 and :v1.71.2 | amd64, arm64 |
| supabase/supavisor:2.9.5 | amd64, arm64 |
| timberio/vector:0.53.0-alpine | amd64, arm, arm64 |
| supabase/logflare:1.43.1 | amd64, arm64 |
| darthsim/imgproxy:v3.30.1 | amd64, arm64 |

Not verified: `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` (GHCR mirror used only by the Coolify template; upstream `minio/minio` is multi-arch, but the mirror's manifests were not checked). The supabase/postgres repo also references `amazon-arm64` builds and "Large Systems Extensions… for ARM images" ([README](https://github.com/supabase/postgres)). **No blocker for arm64.**

## 6. Resource footprint

- **First-party minimums:** "RAM 4 GB | CPU 2 cores | Disk 40 GB SSD", with 8 GB+ / 4 cores recommended ([self-hosting docker guide](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/docker.mdx)).
- **Heaviest services:** Logflare/analytics is the notorious one — 1.8 GiB reported on a 4 GB VPS ([supabase/supabase#32713](https://github.com/supabase/supabase/issues/32713)); a user-posted `docker stats` for a full idle-ish stack showed Kong 2.5 GiB (suspected leak/misconfig), analytics 525 MiB, db 350 MiB, realtime 211 MiB, rest 116 MiB, "Total: ~4GB" ([discussion #26159](https://github.com/orgs/supabase/discussions/26159)). Precisely because analytics is heavy, upstream moved it to the opt-in `docker-compose.logs.yml` overlay, noting "these services increase resource requirements" and that Studio/Auth/Storage/PostgREST/Realtime all work without it ([docker.mdx](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/docker.mdx)).
- **Estimate (mine, derived from the cited numbers, not a first-party figure):** a lean current-upstream stack (no logs overlay; drop imgproxy if Storage image transforms are unneeded) idles around 1.5–2.5 GB. On an 8 GB box: **one full stack with the logs overlay, or comfortably 2 lean stacks (3 at a squeeze)** — leaving headroom for Coolify itself (Coolify's server requirements list 2 GB minimum for its own host, [coolify.io/docs](https://coolify.io/docs/get-started/installation)). The Coolify template always pays the Logflare+Vector+MinIO cost; the official base compose does not.
- Disable candidates: analytics+vector (already off upstream), imgproxy, studio+meta (dashboard only), realtime if the app never subscribes.

## 7. Coolify backups

- Coolify offers cron-scheduled Postgres backups (pg_dump custom format) with delivery to "your own S3 compatible storage" ([coolify.io/docs/databases/backups](https://coolify.io/docs/databases/backups)).
- **Coverage by resource type** (from the compatibility table in [coollabsio/coolify#7528](https://github.com/coollabsio/coolify/issues/7528)): backups **are available** for standalone DB resources, **"Empty Docker Compose"** resources, and **one-click services (e.g. Supabase)** — Coolify detects database containers inside them and creates `ServiceDatabase` records; backups are **NOT available** for compose deployed via the git/GitHub-App `dockercompose` buildpack ("database services are not detected and `ServiceDatabase` records are not created"). The docs page itself doesn't spell this out; the issue does.
- Known wrinkles: downloading a Supabase DB backup via UI once failed with `{"message":"Team not found."}` ([#8431](https://github.com/coollabsio/coolify/issues/8431), closed), and using *Supabase Storage itself* as the S3 backup destination fails (mc "Invalid URL", [#8530](https://github.com/coollabsio/coolify/issues/8530), open) — use a real S3/B2/R2 bucket as the destination.
- **Implication:** to keep Coolify's backup UI, paste the official compose as an **empty Docker Compose resource** rather than pointing Coolify at a git repo containing it.

## 8. Known sharp edges of Supabase-on-Coolify

Recurring themes in `coollabsio/coolify` issues:

- **Template drift:** [#9953](https://github.com/coollabsio/coolify/issues/9953) "supabase template outdated massively. especially pg, gotrue, kong" — fixed by bulk bumps like [PR #8316](https://github.com/coollabsio/coolify/pull/8316), then drifts again (today: PG 15.8 vs upstream 17.6). You upgrade when Coolify updates the template, not when Supabase releases.
- **Edge Functions breakage:** open [#10903](https://github.com/coollabsio/coolify/issues/10903) (fresh deploy: `index.ts` materialized as directory → edge-runtime boot loop), [#8632](https://github.com/coollabsio/coolify/issues/8632) (same "Is a directory" class), [discussion #5983](https://github.com/coollabsio/coolify/discussions/5983) (no way to manage functions from UI); dynamic-deploy PR [#6602](https://github.com/coollabsio/coolify/pull/6602) rejected as too much maintenance.
- **Redeploy/restart credential breakage:** [#8920](https://github.com/coollabsio/coolify/issues/8920) (`invalid_password` for `supabase_admin`, analytics unhealthy after every redeploy), [#8863](https://github.com/coollabsio/coolify/issues/8863) (password auth fails after restart), [#2696](https://github.com/coollabsio/coolify/issues/2696) (containers restart-loop on auth errors) — the pattern is regenerated/out-of-sync secrets between Coolify's env store and the initialized DB volume.
- **Coolify's compose rewriting fights Supabase:** [#2060](https://github.com/coollabsio/coolify/issues/2060) (Coolify overrides `container_name`, breaking Realtime), [#7607](https://github.com/coollabsio/coolify/issues/7607) (`SERVICE_FQDN` vs `SERVICE_URL` broke Studio), [#9518](https://github.com/coollabsio/coolify/issues/9518) (template generated malformed `GOTRUE_SITE_URL`).
- **Analytics/init fragility:** [#4665](https://github.com/coollabsio/coolify/issues/4665) (analytics + dependents can't start on slow first-boot), plus the Studio settings-page error [#7885](https://github.com/coollabsio/coolify/issues/7885) (open).
- **DB exposure needs manual work:** [#3297](https://github.com/coollabsio/coolify/issues/3297) and the documented workaround in [Coolify's Supabase docs](https://coolify.io/docs/services/supabase).

**Assessment:** the one-click template's value is the generated secrets (`SERVICE_PASSWORD_JWT` + auto-minted anon/service JWTs) and zero-file setup. Its costs — version drift, forced analytics, content-mount bugs on the exact service we depend on (edge functions), and redeploy secret drift — all hit this project directly. The official compose run as a Coolify **empty Docker Compose resource** keeps Coolify's proxy/FQDN handling and scheduled backups while removing template drift and the broken content-mount mechanism (the functions directory becomes a plain directory you own on the server). That is the saner route.

---

## Recommendation

**Deploy the official `supabase/docker` compose as a Coolify "Docker Compose (empty)" resource.** Concretely:

1. **Stack:** copy the current [`docker/docker-compose.yml`](https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml) + [`.env` from `.env.example`](https://raw.githubusercontent.com/supabase/supabase/master/docker/.env.example) into a Coolify empty-compose resource, pinning today's tags (db `supabase/postgres:17.6.1.136`, functions `supabase/edge-runtime:v1.74.0`, auth `supabase/gotrue:v2.189.0`, rest `postgrest/postgrest:v14.12`, kong `kong/kong:3.9.1`, studio, meta, storage, imgproxy, realtime, supavisor as listed in §1). Skip the `docker-compose.logs.yml` overlay — saves ~1 GB+ (§6). Generate `JWT_SECRET`/`ANON_KEY`/`SERVICE_ROLE_KEY` with `sh utils/generate-keys.sh` per the `.env.example` instructions (do not keep the demo keys). Set `DISABLE_SIGNUP=true` (default is `false`) to disable GoTrue signups. Keep only Kong (port 8000) behind Coolify's proxy/FQDN; supavisor's `5432`/`6543` mappings are already in the compose — firewall them to your IP.
2. **`refresh` Edge Function:** code lives in the repo and is synced to the server path the resource mounts, i.e. `volumes/functions/refresh/index.ts` next to the stock `volumes/functions/main/index.ts` router (copy `main` verbatim from upstream). Reached at `https://<kong-fqdn>/functions/v1/refresh` → router spawns `/home/deno/functions/refresh` (§2).
3. **Secrets (`TMDB_BEARER` etc.):** set as env vars on the `functions` service via Coolify's Environment Variables UI (referenced `${TMDB_BEARER}` in the compose). `main/index.ts` forwards the whole container environment to user workers, so `Deno.env.get('TMDB_BEARER')` just works. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` are already provided by the compose.
4. **Scheduling:** one-time SQL (via `supabase db push --db-url` against supavisor session port 5432, or psql): `create extension if not exists pg_cron;` (pg_net is already created by `webhooks.sql`; both plus `supabase_vault` are preloaded — §3). Store the function URL and a key in Vault: `select vault.create_secret('http://kong:8000', 'project_url'); select vault.create_secret('<anon-or-service-key>', 'function_key');` then per the [official pattern](https://supabase.com/docs/guides/functions/schedule-functions): `select cron.schedule('refresh-hourly', '0 * * * *', $$ select net.http_post( url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/refresh', headers := jsonb_build_object('Content-Type','application/json', 'apikey', (select decrypted_secret from vault.decrypted_secrets where name='function_key'), 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='function_key')), body := '{}'::jsonb) $$);` — `apikey` satisfies Kong's key-auth, the `Authorization` bearer satisfies the router if you set `FUNCTIONS_VERIFY_JWT=true` (default `false`; the check is global, not per-function — §2). Using the internal `http://kong:8000` URL keeps the cron call off the public internet.
5. **Redeploys:** `supabase functions deploy` cannot target this stack (§2). Flow: update `volumes/functions/refresh/index.ts` on the server (rsync/scp/CI step), then restart only the functions container (`docker restart <functions-container>` or Coolify's per-service restart) — equivalent of the documented `sh run.sh restart functions`. Schema changes: `supabase db push --db-url 'postgresql://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@<host>:5432/postgres'` (§4).
6. **Backups:** enable Coolify's scheduled backup on the detected Postgres inside the compose resource (works for empty-compose per [#7528](https://github.com/coollabsio/coolify/issues/7528)) targeting an external S3-compatible bucket — not Supabase Storage itself ([#8530](https://github.com/coollabsio/coolify/issues/8530)). Verify the first backup restores.

All images are amd64+arm64 (§5), so the server architecture is unconstrained. Budget ≥4 GB RAM for the stack per Supabase's stated minimum; on an 8 GB box expect room for this stack plus the notifier app, or two lean stacks (§6).
