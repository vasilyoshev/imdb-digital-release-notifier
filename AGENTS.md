# Agent instructions — imdb-digital-release-notifier

Release-tracking console (Vite SPA) + Supabase Edge Functions backend. Domain glossary and
ubiquitous language: [`CONTEXT.md`](CONTEXT.md).

## Branches & deploys

- **Production branch is `rebuild`** — `main` carries the undeployed v2 rewrite (multi-tenant
  Console); consolidation is a pending product decision, not a routine merge. Do not deploy or
  fast-forward `main` into production without an explicit owner decision.
- Hosting: **Cloudflare Workers static assets** (Netlify-exit migration, control-tower
  `docs/migrations/netlify-exit.md` §4b). `deploy.yml` builds and deploys `dist/` on push to
  `rebuild` via wrangler; it skips the deploy while the `CLOUDFLARE_*` Actions secrets are
  unprovisioned. Public build env comes from GitHub Actions **variables** (`VITE_*`).
- Rollback = redeploy a prior commit (dispatch `deploy.yml` on it); no provider-side rollback.

## Architecture rule

Architectural changes must update control-tower. If this change adds/removes/moves a service,
changes hosting/provider, adds or changes a domain or public URL, introduces a new external or
cross-project dependency, or touches a credential — file a control-tower issue
(`gh issue create -R vasilyoshev/control-tower ...`) or edit its `docs/inventory.md` directly if
you have it checked out. Canonical rule:
https://github.com/vasilyoshev/control-tower/blob/main/docs/architecture-rule.md
