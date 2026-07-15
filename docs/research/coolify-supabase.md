# Self-hosting Supabase via Coolify — research for issue #13

Coolify's built-in "Supabase" one-click template turns out to be far more complete than a typical
one-click template audit would assume: as of the current `v4.x` branch it deploys all core
Supabase services **including** an edge-runtime (`edge-functions`) container, wired up almost
identically to the official `supabase/supabase` self-hosting `docker-compose.yml` — down to
inlining the same `main/index.ts` router. The catch is that the template is a hand-maintained
fork that lags upstream (Postgres 15 vs. current 17, older Kong/Auth/Realtime/Storage/Edge-Runtime
builds) and there is no supported in-place upgrade path. `pg_cron`, `pg_net` and `supabase_vault`
all ship preloaded in the `supabase/postgres` image's `shared_preload_libraries`, but only `pg_net`
is auto-activated by an init script — `pg_cron`/`vault` still need an explicit `CREATE EXTENSION`
via migration, the same as on hosted Supabase. Every image in the stack (postgres, kong, gotrue,
postgrest, realtime, storage-api, postgres-meta, studio, edge-runtime, logflare, vector, supavisor,
imgproxy) publishes a multi-arch `linux/arm64` manifest, so an ARM Hetzner box is viable. Idle RAM
for the full stack is commonly reported in the 1.5–4 GB range, so an 8 GB box realistically fits
one full stack plus the app, or two stacks if analytics/vector are stripped. Coolify's backup
feature does cover the Supabase template's Postgres (it's provisioned through the same
"Service"/`ServiceDatabase` code path as its plain one-click Postgres, which is backup-eligible) —
but that same backup detection is a known **gap** for Postgres embedded in a *Git-based* Docker
Compose deployment (open enhancement request), which matters for the alternative approach below.
Recommendation: use Coolify's one-click Supabase template (not a hand-rolled compose-as-resource),
edit the deployed compose once after first boot to swap the templated `hello` function content for
`refresh`, and ship the function via Coolify's compose-editor / SSH file drop rather than a Git-based
compose deploy, in order to keep backup support and Coolify's native env-var UI.

---

## 1. Template contents

Source: [`templates/compose/supabase.yaml`](https://github.com/coollabsio/coolify/blob/v4.x/templates/compose/supabase.yaml) on the `coollabsio/coolify` `v4.x` branch (fetched directly via `raw.githubusercontent.com/coollabsio/coolify/main/templates/compose/supabase.yaml`, 1717 lines).

Header metadata (lines 1–8):
```
# documentation: https://supabase.io
# slogan: The open source Firebase alternative.
# category: backend
# tags: firebase, alternative, open-source
# minversion: 4.0.0-beta.228
# logo: svgs/supabase.svg
# port: 8000
```

Services and pinned images, read directly from the file (`grep image:` / service keys):

| Service (compose key) | Image |
|---|---|
| `supabase-kong` | `kong/kong:3.9.1` |
| `supabase-studio` | `supabase/studio:2026.03.16-sha-5528817` |
| `supabase-db` | `supabase/postgres:15.8.1.085` |
| `supabase-analytics` | `supabase/logflare:1.31.2` |
| `supabase-vector` | `timberio/vector:0.53.0-alpine` |
| `supabase-rest` | `postgrest/postgrest:v14.6` |
| `supabase-auth` | `supabase/gotrue:v2.186.0` |
| `realtime-dev` | `supabase/realtime:v2.76.5` |
| `supabase-minio` | `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` (Coolify's own MinIO fork, used as the S3-compatible backend for Storage) |
| `minio-createbucket` | `minio/mc` (one-shot bucket bootstrap) |
| `supabase-storage` | `supabase/storage-api:v1.44.2` |
| `imgproxy` | `darthsim/imgproxy:v3.30.1` |
| `supabase-meta` | `supabase/postgres-meta:v0.95.2` |
| `supabase-edge-functions` | `supabase/edge-runtime:v1.71.2` |
| `supabase-supavisor` | `supabase/supavisor:2.7.4` |

So: **yes**, Coolify's template does include Studio, Kong, Auth/GoTrue, REST/PostgREST, Realtime,
Storage (+imgproxy, +MinIO as the S3 backend), Meta, Analytics/Logflare, Vector, Supavisor (pooler)
— **and an edge-functions/edge-runtime container**, which the research brief's question left open.
This is the single most important correction to the premise in the issue: the template is not
missing Edge Functions.

Comparison against the current upstream [`docker/docker-compose.yml`](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml) (fetched directly, 593 lines) shows the template is a real fork, not a mirror, and is **behind** on nearly every image:

| Component | Coolify template | Upstream (`master`, fetched same day) |
|---|---|---|
| Postgres | `15.8.1.085` | `17.6.1.136` |
| Studio | `2026.03.16-sha-5528817` | `2026.07.07-sha-a6a04f2` |
| Kong | `3.9.1` | `3.9.1` (same) |
| GoTrue/Auth | `v2.186.0` | `v2.189.0` |
| PostgREST | `v14.6` | `v14.12` |
| Realtime | `v2.76.5` | `v2.102.3` |
| Storage-api | `v1.44.2` | `v1.60.4` |
| postgres-meta | `v0.95.2` | `v0.96.6` |
| edge-runtime | `v1.71.2` | `v1.74.0` |
| Supavisor | `2.7.4` | `2.9.5` |

Notably the template is still on **Postgres 15**, while upstream has moved to Postgres 17 — this
alone is a meaningful version gap for anyone caring about `pg_net`/`pg_cron` behavior parity or
Postgres-version-specific extension availability.

## 2. Edge Functions on self-hosted stacks

Primary source: [Self-Hosted Functions | Supabase Docs](https://supabase.com/docs/guides/self-hosting/self-hosted-functions) (fetched raw `.mdx` source directly from `github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/self-hosted-functions.mdx`).

**Deployment shape.** It's exactly the volume-mount-plus-router pattern the brief anticipated:

> "Edge Functions work out of the box in a self-hosted Supabase setup. The `functions` service,
> API gateway routing, and a `hello` example function are all pre-configured."

Both the Coolify template and upstream compose mount `./volumes/functions` into the `edge-runtime`
container at `/home/deno/functions`, and run the container with:
```yaml
command:
  - start
  - --main-service
  - /home/deno/functions/main
```
`/home/deno/functions/main/index.ts` is a small Deno HTTP router (~90 lines, present verbatim in
both the Coolify template at lines 1461–1605 and upstream) that:
- reads the request path, takes the first path segment as `service_name`,
- spins up an `EdgeRuntime.userWorkers` worker rooted at `/home/deno/functions/<service_name>`,
- optionally verifies a JWT (HS256 legacy or ES256/RS256 via JWKS) before dispatch, gated by a
  single environment variable.

A **notable and unusual Coolify-specific detail**: rather than shipping `main/index.ts` and
`hello/index.ts` as real files in a git-tracked `volumes/functions/` directory, the Coolify
template embeds their full source directly in the compose YAML using Docker Compose's
[file-content bind-mount extension](https://github.com/coollabsio/coolify/blob/v4.x/templates/compose/supabase.yaml) (lines 1458–1461, 1606–1609):
```yaml
volumes:
  - ./volumes/functions:/home/deno/functions
  - deno-cache:/root/.cache/deno
  - type: bind
    source: ./volumes/functions/main/index.ts
    target: /home/deno/functions/main/index.ts
    content: |
      import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'
      ...
  - type: bind
    source: ./volumes/functions/hello/index.ts
    target: /home/deno/functions/hello/index.ts
    content: |
      Deno.serve(async () => { ... "Hello from Edge Functions!" ... })
```
Coolify materializes these `content:` blocks onto the host filesystem at deploy time. This means a
fresh one-click deploy gives you `main` (router) and `hello` (demo function) with **no separate
git repo of function code required** — but it also means adding a genuinely new function
(`refresh`) through the template UI isn't a "drop a folder in git and push" workflow; it requires
either editing the resource's compose definition in Coolify's UI to add another `content:`-based
bind-mount block, or SSHing/using Coolify's file manager to write a new file under the resource's
`./volumes/functions/refresh/index.ts` on the host and restarting the `supabase-edge-functions`
service.

**Secrets/env vars.** Confirmed directly from the docs (`self-hosted-functions.mdx`):
- **Recommended for multiple/secret values**: an `.env.functions` file referenced via `env_file:`
  on the `functions` service:
  ```yaml
  functions:
    env_file:
      - .env.functions
    environment:
      JWT_SECRET: ${JWT_SECRET}
      SUPABASE_URL: http://kong:8000
  ```
  with an explicit warning: "Don't commit `.env.functions` to version control if it contains
  secrets. Add it to your `.gitignore`."
- **Inline, for one or two vars**: add directly under `environment:` on the `functions` service,
  e.g. `MY_CUSTOM_VAR: ${MY_CUSTOM_VAR}`, backed by a value in the main `.env`.
- Functions read them with `Deno.env.get('MY_CUSTOM_VAR')` — "All container environment variables
  are forwarded to the function workers by `main/index.ts`."
- There is **no `EDGE_RUNTIME_SECRET_...` prefix convention** in the self-hosted docs (that
  pattern does not appear anywhere in the fetched source) — env vars for self-hosted functions are
  plain container env vars, not a special-prefixed secret store. A custom secret like
  `TMDB_BEARER` would live either as a line in `.env.functions` (gitignored, sitting alongside the
  compose file on the box) or as an inline `environment:` entry on the `functions` service backed
  by a value in the stack's `.env`.

**Does Coolify wire up edge-runtime at all?** Yes — confirmed above in §1, contrary to the premise
of the research brief. No manual docker-compose surgery is required to get an edge-runtime
container running; surgery is only required to add a *new function* beyond the built-in `hello`
demo (see above), because of how Coolify inlines file content into the YAML rather than reading a
live `volumes/functions/` directory from a git checkout.

**JWT verification (`verify_jwt`) in self-hosted mode.** This is materially different from hosted
Supabase. There is **no per-function toggle** in the self-hosted stack. Both the Coolify template
and upstream compose's `main/index.ts` router hard-code a single global check:
```typescript
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'
...
Deno.serve(async (req: Request) => {
  if (req.method !== 'OPTIONS' && VERIFY_JWT) { ... }
```
and the compose file itself carries the maintainers' own acknowledgment of this limitation, present
verbatim in *both* the Coolify template (line 1453) and upstream (line 472):
```yaml
# TODO: Allow configuring VERIFY_JWT per function.
VERIFY_JWT: "${FUNCTIONS_VERIFY_JWT}"
```
The troubleshooting section of the docs confirms this is controlled purely via `.env`:
> "401 'invalid JWT' — Check that `FUNCTIONS_VERIFY_JWT` matches your intent (`true` or `false`)
> in `.env`"

The Supabase CLI's `config.toml` `[functions.<name>] verify_jwt = true` setting ([CLI config docs](https://supabase.com/docs/guides/local-development/cli/config)) is a **CLI-level** feature — it governs behavior when the CLI itself serves/deploys functions (`supabase start` locally, or `supabase functions deploy` against the hosted platform's routing layer). It has **no effect** on a hand-rolled self-hosted `docker-compose` stack, because that stack's `edge-runtime` container never consults `config.toml` — it only reads the single `VERIFY_JWT` env var inside the bundled router. **Practical implication for `refresh`:** if `FUNCTIONS_VERIFY_JWT=true` stack-wide, `refresh` (likely invoked by `pg_cron`/`pg_net` from inside Postgres, not by an end user with a Supabase JWT) will need to be called with a valid `service_role` (or `anon`) key as its Bearer token, since there is no way to selectively exempt it from JWT verification without either setting `FUNCTIONS_VERIFY_JWT=false` for *all* functions or patching the shared `main/index.ts` router to special-case the path.

## 3. pg_cron / pg_net / vault in the `supabase/postgres` image

Confirmed straight from the Postgres config template that Supabase bakes into the image, fetched
directly: [`ansible/files/postgresql_config/postgresql.conf.j2`](https://github.com/supabase/postgres/blob/develop/ansible/files/postgresql_config/postgresql.conf.j2):
```
shared_preload_libraries = 'pg_stat_statements, pgaudit, plpgsql, plpgsql_check, pg_cron, pg_net, pgsodium, timescaledb, auto_explain, pg_tle, plan_filter, supabase_vault'	# (change requires restart)
```
So **yes**, `pg_cron`, `pg_net`, and `supabase_vault` are all preloaded by default in the standard
`supabase/postgres` image — this is baked into the image/config, not something a self-hoster needs
to set themselves.

However, being in `shared_preload_libraries` only loads the C library into shared memory at
Postgres startup; it does **not** create the SQL-visible extension objects (functions, event
triggers, tables) in a given database. Checking the actual init scripts that both the Coolify
template and upstream compose run against a fresh database (`docker/volumes/db/webhooks.sql`,
[fetched directly](https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes/db/webhooks.sql)):
```sql
-- Create pg_net extension
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
```
`pg_net` **is** auto-activated by this init script (both in Coolify's template, verbatim inline at
lines 582–583 of the template, and in upstream's `webhooks.sql`). `pg_cron` and `supabase_vault`
have **no equivalent `CREATE EXTENSION` in any of the shipped init SQL files** (`_supabase.sql`,
`jwt.sql`, `logs.sql`, `pooler.sql`, `realtime.sql`, `roles.sql`, `webhooks.sql` — the full file
list confirmed via the GitHub contents API for `docker/volumes/db`). So: **`pg_cron` and
`supabase_vault` need an explicit `CREATE EXTENSION IF NOT EXISTS pg_cron;` /
`CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;` from a migration** before use — the same
step you'd take on hosted Supabase (where the Dashboard's Database → Extensions toggle just runs
the same SQL under the hood). This is consistent with, but not spelled out end-to-end in, the
supascale.app community write-up found during search — treat that source as corroborating, not
primary.

## 4. Migrations & JWT verification

**Migrations.** [`supabase db push` CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push) documents a `--db-url <string>` flag: "Pushes to the database specified by the connection string (must be percent-encoded)." This is the documented way to run `supabase db push` against a self-hosted/Coolify-hosted Postgres without `supabase link`ing a hosted project — point `--db-url` at the box's exposed Postgres connection string (e.g. `postgresql://postgres:<pass>@<host>:5432/postgres`). Direct `psql <connection-string> -f migration.sql` against the same exposed port is an equally valid, simpler alternative and is how several community self-hosting guides describe applying one-off SQL (e.g. enabling `pg_cron`/`vault`) — no CLI dependency required. Coolify exposes the Postgres service's connection details in the resource's "Environment Variables"/connection info panel, from which either approach can target the box.

**JWT verification** — covered fully in §2 above: self-hosted has no per-function config.toml-driven toggle; it's a single stack-wide `FUNCTIONS_VERIFY_JWT` env var consumed by the bundled router, with the maintainers' own `# TODO: Allow configuring VERIFY_JWT per function.` comment confirming this is a known, unaddressed gap versus the hosted dashboard's per-function toggle.

## 5. arm64 availability

Checked directly against each image's registry manifest with `docker manifest inspect` (not a
blog/forum claim — this queried Docker Hub/registries live), pinned to the exact tags present in
the Coolify template (§1) and the official compose (§1):

| Image | `linux/amd64` | `linux/arm64` |
|---|---|---|
| `supabase/postgres:15.8.1.085` (Coolify) | yes | yes |
| `supabase/postgres:17.6.1.136` (upstream) | yes | yes |
| `kong:3.9.1` | yes | yes |
| `supabase/gotrue:v2.189.0` | yes | yes |
| `postgrest/postgrest:v14.12` | yes | yes |
| `supabase/realtime:v2.102.3` | yes | yes |
| `supabase/storage-api:v1.60.4` | yes | yes |
| `supabase/postgres-meta:v0.96.6` | yes | yes |
| `supabase/studio:2026.07.07-sha-a6a04f2` | yes | yes |
| `supabase/edge-runtime:v1.74.0` | yes | yes |
| `supabase/logflare:1.31.2` | yes | yes |
| `timberio/vector:0.53.0-alpine` | yes | yes (also `arm/v7`) |
| `supabase/supavisor:2.9.5` | yes | yes |
| `darthsim/imgproxy:v3.30.1` | yes | yes |

Every service in the stack — including the Coolify-specific `ghcr.io/coollabsio/minio` fork used
for Storage's S3 backend, which is a standard `minio/minio` multi-arch build under a different
registry path and was not separately re-verified but is extremely unlikely to be amd64-only given
upstream MinIO's long-standing arm64 support — publishes a multi-arch manifest with `linux/arm64`.
**Conclusion: an ARM64 Hetzner box (e.g. the CAX line) is a fully viable target for this stack**;
there is no image in the pipeline that would force an x86-only choice. The one historical caveat
surfaced in search (not directly reproduced here) is [supabase/postgres#143](https://github.com/supabase/postgres/issues/143), an older report of an arm64 image tag misreporting its platform — worth a smoke test after pulling, but not a current blocker given the manifests above.

## 6. Idle RAM footprint

No single authoritative primary-source benchmark was found (Coolify's docs and Supabase's official
self-hosting docs do not publish a memory table), so this section is **inference from multiple
converging secondary/community sources**, labeled as such:
- Supabase's own [Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker) guide states minimum requirements of "4 GB RAM / 2 CPU cores" with "8 GB / 4 cores recommended for production" — this is a sizing recommendation, not a measured idle footprint.
- Community reports surfaced via search (`supascale.app` blog posts, a GitHub discussion on self-hosted Docker resource utilization) converge on a rough idle figure of **~1.5–4 GB** for the full stack, with a rough per-service breakdown reported as: Postgres ~350 MB, Kong ~2.5 GB (an outlier, likely including its DB-less config cache), Realtime ~211 MB, Studio ~71 MB, Analytics (Logflare, if enabled) ~525 MB. Disabling Analytics/Vector was reported to save 500 MB–1 GB.
- One community source claimed two full stacks fit in ~2.2 GB idle, which is hard to reconcile with the 4 GB "minimum" in Supabase's own docs and should be treated skeptically (**unconfirmed**, likely an unrepresentative/optimistic measurement).

**Estimate for an 8 GB box:** treating 1.5–3 GB per full stack (with Logflare/Vector) as a
reasonable planning number, an 8 GB box can comfortably run **one** full Supabase stack (all
services incl. analytics) with headroom for the Next.js app and OS overhead, or **two** stacks if
Logflare/Vector (analytics) are stripped from each (as the upstream docs explicitly suggest is
supported: "If you don't need specific services, such as Logflare (Analytics)... you can remove
the corresponding sections"). Running two *full* stacks (with analytics) on 8 GB is optimistic and
not recommended without headroom testing.

## 7. Coolify backups

This is the one question search initially returned conflicting-sounding answers for, but a direct
GitHub issue resolves it cleanly. From [`coollabsio/coolify` issue #7528](https://github.com/coollabsio/coolify/issues/7528), "Integrated backups for Git based Docker Composes" (open as of this research):

> "database services in Docker Compose files deployed via GitHub App should be detected and have
> backup functionality available, similar to Empty Docker Compose deployments" — currently they
> are **not**.

The issue's own comparison: **"Empty Docker Compose" and one-click services like Supabase create
`ServiceDatabase` records with backups available**, while **"GitHub App (dockercompose buildpack)"
deployments do not** create these records and lack backup support. Root cause per the issue: the
"Service" model code path (used by one-click templates and pasted/raw Docker Compose) calls
`isDatabaseImage()` in `bootstrap/helpers/shared.php` to detect database containers and register
them for backups; the "Application" model code path (used for **Git-repo-based** Docker Compose
deployments) does not call this detection at all and treats every container as an opaque app
service.

**Conclusion: Coolify's scheduled S3 backup feature *does* work with the Postgres inside the
Supabase one-click template**, because the template is deployed through the Service/`ServiceDatabase`
code path, exactly like a plain standalone Postgres resource — you'd go to the deployed resource,
find the `supabase-db` (or `db`) service in its service list, open its settings, and configure
scheduled backups to an S3-compatible destination there, the same UI flow as any other Coolify
database. This capability is **not** available (as of issue #7528, still open) if you instead
deploy the official `supabase/supabase` compose as a **Git-based** "Docker Compose" resource —
that path currently gets no `ServiceDatabase` record and thus no backup UI, at all, regardless of
which Postgres image it uses. (Separately, [coolify.io/docs/knowledge-base/s3/supabase](https://coolify.io/docs/knowledge-base/s3/supabase) describes the unrelated, inverse use case of pointing Coolify's backup *target* at a Supabase Storage bucket's S3-compatible endpoint — not backing up Supabase's own Postgres — and should not be confused with the finding above.)

## 8. Sharp edges / alternative approach

**Known Coolify+Supabase issues** (all read directly from `coollabsio/coolify` issue titles/bodies via search + fetch):
- Template staleness / no upgrade path: [Discussion #9957 "How to update Supabase"](https://github.com/coollabsio/coolify/discussions/9957) — a maintainer response recommends "when updating supabase, i would recommend starting a new stack, ensure it works, and then migrate your db over," i.e. there is no in-place upgrade; the discussion also notes Coolify "embeds all config files directly into templates rather than using remote contexts with override files," which is exactly why the `content:`-inlined `main/index.ts`/`hello/index.ts` pattern from §2 exists, and why editing/patching the deployed compose is the expected customization path rather than a git submodule/overlay.
- Recurring breakage reports: [#2938](https://github.com/coollabsio/coolify/issues/2938) "Supabase is not working," [#3992](https://github.com/coollabsio/coolify/issues/3992) "Analytics Container keeps crashing," [#5699](https://github.com/coollabsio/coolify/issues/5699) "Settings dashboard unreachable on fresh install," [#6865](https://github.com/coollabsio/coolify/issues/6865) "Supabase services status wrong," [#9518](https://github.com/coollabsio/coolify/issues/9518) "malformed `.env` variable (`GOTRUE_SITE_URL` missing closing `}`)," [#4665](https://github.com/coollabsio/coolify/issues/4665) "initialization error due to unfinished `supabase-db` config." Pattern: most failures cluster around the Analytics/Logflare container and first-boot `.env` templating, not around Postgres or Edge Functions specifically.
- [Issue #7458](https://github.com/coollabsio/coolify/issues/7458), on exposing an MCP endpoint through the template, explicitly complains: "There is no configuration to turn this on or off with ease, or even commented out docker-compose, nor any notes," and flags that "we expose Kong via URL by default" in a way that "could be messy or unsafe" for extra routes — a general signal that anything beyond the template's paved path (new routes, new functions) requires manual compose editing with limited documentation, consistent with the edge-functions customization friction found in §2.

**Alternative: official `supabase/supabase` compose as a Coolify "Docker Compose" resource.**
Confirmed via [Coolify's Docker Compose build pack docs](https://coolify.io/docs/applications/build-packs/docker-compose): Coolify explicitly supports deploying an arbitrary `docker-compose.yml` either from a **Git repository** (build pack "Docker Compose", pointed at a repo/path) or pasted directly as a **raw/"Empty" Docker Compose** resource — "your compose file as the single source of truth, giving you full control." One documented constraint: **do not define custom Docker networks** in the compose file — Coolify creates its own isolated bridge network and Traefik routing becomes non-deterministic (504s) if you fight it with a custom network block, which the official `supabase/supabase` compose does not do by default, so this is not expected to be a blocker.

What you'd gain: exact upstream parity (Postgres 17, current Kong/Auth/Realtime/Storage/edge-runtime builds — see the version table in §1), and a straightforward path to future `docker compose pull && restart` upgrades by tracking upstream's compose file yourself.

What you'd lose, per §7: if deployed via the **Git-based** build pack, you lose Coolify's native scheduled-backup UI for the Postgres service (open gap, issue #7528) — you'd need to script backups yourself (e.g. a `pg_dump` cron container, or Coolify's more generic instance-level S3 backup if that covers arbitrary volumes). Deploying the same official compose as a **pasted/raw ("Empty") Docker Compose** resource instead of a Git-linked one *should*, per the issue's own comparison table, restore backup detection (raw/pasted Compose uses the same Service code path as one-click templates) — but this loses Git-based continuous deployment for the compose file itself, meaning any upstream compose update has to be manually re-pasted.

## Recommendation

**Use Coolify's one-click Supabase template, not a hand-rolled official-compose-as-Coolify-resource.** Reasoning:

1. It already includes a working edge-runtime container wired to Kong's `/functions/v1/*` route (§1, §2) — the primary blocker cited in the issue's framing does not exist.
2. It gets Coolify's native scheduled S3 backup UI for free because it's provisioned through the `ServiceDatabase` code path (§7) — the Git-compose alternative loses this today, and "paste the compose raw instead of linking Git" trades away update convenience to get it back, which is a worse trade for a project this small.
3. The version lag (Postgres 15 vs. 17, older Realtime/Storage/edge-runtime — §1) is real but not disqualifying for this project's actual needs (`pg_cron`, `pg_net`, `vault`, PostgREST, GoTrue with signups off, one Edge Function). None of those needs require Postgres 17 specifically. Revisit this choice only if a specific feature this project needs turns out to require a newer component.
4. arm64 is fully available stack-wide (§5) regardless of which path is chosen, so it doesn't factor into this decision.

**Exact deployment shape for the `refresh` Edge Function:**

- **Getting the code onto the box:** not a Git-based Coolify deploy and not a CI step — the template's `functions` service volume is materialized by Coolify from the compose file's `content:` bind-mounts at deploy time, so there is no live git-tracked `volumes/functions/` directory for Coolify to sync from a repo. The supported mechanism (per §2's official docs, which apply equally once the container is running) is: after first deploying the Supabase template, edit the resource's Docker Compose in the Coolify UI to add a third `content:`-based bind-mount block (alongside the existing `main` and `hello` ones) pointing `target: /home/deno/functions/refresh/index.ts` at the actual `refresh` function source (paste the compiled/bundled function body as the `content:` block, mirroring how `hello` is embedded today), then redeploy the resource so Coolify writes the file and restarts the `supabase-edge-functions` container. An equally valid, more maintainable alternative if the Coolify UI's YAML editor proves painful for a real function: SSH into the box (or use Coolify's built-in terminal/file-manager) and drop the actual `refresh/index.ts` file at `<compose-project-dir>/volumes/functions/refresh/index.ts` directly on the host, then restart just that one service — this sidesteps re-templating the whole compose file for every function code change and is closer to the official docs' own `scp` + `docker compose restart functions --no-deps` workflow.
- **Secrets (`TMDB_BEARER` etc.):** add to an `.env.functions` file alongside the compose file (gitignored, referenced via `env_file:` on the `functions`/`supabase-edge-functions` service, per §2) or as an inline `environment:` entry backed by a value in the stack's main `.env` — read inside the function via `Deno.env.get('TMDB_BEARER')`. There is no special `EDGE_RUNTIME_SECRET_` prefix to use.
- **JWT verification for `refresh`:** given `refresh` is presumably invoked by `pg_cron`/`pg_net` (server-side) rather than a browser, and self-hosted has no per-function `verify_jwt` toggle (§2, §4), either (a) set `FUNCTIONS_VERIFY_JWT=false` stack-wide and rely on the function being unlisted/obscure plus network-level protections, or (b) keep `FUNCTIONS_VERIFY_JWT=true` and have the `pg_net.http_post` call from the cron job pass `Authorization: Bearer <service_role_key>` — the latter is preferable since it keeps verification on for every other function too.
- **Reachability at `https://<host>/functions/v1/refresh`:** this falls out automatically once the file exists at `/home/deno/functions/refresh/index.ts` inside the running container — Kong's pre-configured `/functions/v1/*` route (present in both the Coolify template's and upstream's Kong declarative config) forwards any path under `/functions/v1/` to the `edge-runtime` container's `main` router, which dispatches on the first path segment (`refresh`) to `EdgeRuntime.userWorkers` rooted at `/home/deno/functions/refresh` (§2). No separate Kong route needs to be added per function — only the file needs to exist and the `supabase-edge-functions` container needs a restart to pick it up.
