# Research: Open signup on self-hosted Supabase (GoTrue / supabase/auth)

- **Date:** 2026-07-16
- **Question:** What does open signup on self-hosted Supabase Auth require — signup env vars and their docker-compose mapping, email confirmation/SMTP (and whether SMTP is needed for OAuth-only), Google OAuth for arbitrary public users (redirect URI, consent-screen publishing/verification), abuse controls (rate limits, captcha, disposable-email blocking, per-user quotas), and RLS/anon implications?
- **Primary sources:** [supabase.com/docs self-hosting/docker](https://supabase.com/docs/guides/self-hosting/docker), [self-hosting/auth/config](https://supabase.com/docs/guides/self-hosting/auth/config), [supabase/auth README](https://github.com/supabase/auth/blob/master/README.md), [example.env](https://github.com/supabase/auth/blob/master/example.env), [internal/conf/configuration.go](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go), [CHANGELOG.md](https://github.com/supabase/auth/blob/master/CHANGELOG.md), [supabase/docker compose + .env.example + kong.yml](https://github.com/supabase/supabase/tree/master/docker), [Google Auth Platform: manage app audience](https://support.google.com/cloud/answer/15549945), provider pricing pages (fetched 2026-07-16).

## Current state in this repo

- The production self-hosted stack lives at `https://api.notifier.yoshevbot.uk`; its docker-compose/.env is **not** in this repo. `docs/SPEC.md` §13 plans `GOTRUE_DISABLE_SIGNUP=true` after creating a single account (single-user model today).
- Local dev `supabase/config.toml`: `enable_signup = true`, `[auth.email] enable_confirmations = false`, production SMTP block commented out, `[auth.captcha]` commented out (hcaptcha/turnstile supported), `[auth.rate_limit]` present (e.g. `email_sent = 2`/hr).
- `supabase/migrations/20260715120000_schema.sql`: RLS enabled on all tables, but every policy is `to authenticated ... using (true)` — no `anon` policies, and lists/settings are UPDATE-able by **any** authenticated user (no owner columns). **Opening signup therefore lets any new user modify lists/settings until policies are tightened.**
- A Google SSO button already exists on the login screen (frontend).

## 1. Enabling signups on a self-hosted docker stack

GoTrue-level switches ([self-hosting auth config](https://supabase.com/docs/guides/self-hosting/auth/config), [supabase/auth README](https://github.com/supabase/auth/blob/master/README.md)):

| Env var | Meaning |
|---|---|
| `GOTRUE_DISABLE_SIGNUP` | "When signup is disabled the only way to create new users is through invites. Defaults to `false`, all signups enabled." Open signup = leave `false`. |
| `GOTRUE_EXTERNAL_EMAIL_ENABLED` | "Use this to disable email signups (users can still use external OAuth providers to sign up / sign in)" — i.e. `false` gives you OAuth-only signup while `GOTRUE_DISABLE_SIGNUP=false`. |
| `GOTRUE_SITE_URL` | "The base URL of your website. Used as an allow-list for redirects and for constructing URLs used in emails." → set to the frontend, e.g. `https://imdb-notifier-yoshev.netlify.app`. |
| `GOTRUE_URI_ALLOW_LIST` | "A comma-separated list of URIs … permitted as valid `redirect_to` destinations. Defaults to []. Supports wildcard matching through globbing" (e.g. `https://*.foo.example.com`). |
| `API_EXTERNAL_URL` | "used by the Auth service to configure callback URLs, e.g. `http://example.com:8000/auth/v1`" ([docker guide](https://supabase.com/docs/guides/self-hosting/docker)); also becomes `GOTRUE_JWT_ISSUER` in the compose. Here: `https://api.notifier.yoshevbot.uk`. |

How the [supabase/docker compose](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml) maps `.env` → GoTrue container env (auth service `supabase/gotrue`, internal port 9999, **no direct port mapping** — reachable only through Kong):

| `.env` var ([defaults from .env.example](https://github.com/supabase/supabase/blob/master/docker/.env.example)) | GoTrue env |
|---|---|
| `DISABLE_SIGNUP=false` | `GOTRUE_DISABLE_SIGNUP` |
| `ENABLE_EMAIL_SIGNUP=true` | `GOTRUE_EXTERNAL_EMAIL_ENABLED` |
| `ENABLE_EMAIL_AUTOCONFIRM=false` | `GOTRUE_MAILER_AUTOCONFIRM` |
| `ENABLE_PHONE_SIGNUP=true` / `ENABLE_PHONE_AUTOCONFIRM=true` | `GOTRUE_EXTERNAL_PHONE_ENABLED` / `GOTRUE_SMS_AUTOCONFIRM` |
| `SITE_URL=http://localhost:3000` | `GOTRUE_SITE_URL` |
| `ADDITIONAL_REDIRECT_URLS=` | `GOTRUE_URI_ALLOW_LIST` |
| `API_EXTERNAL_URL=http://localhost:8000` | `API_EXTERNAL_URL` + `GOTRUE_JWT_ISSUER` |
| `SMTP_*` | `GOTRUE_SMTP_*` (see §2) |
| `MAILER_URLPATHS_*="/auth/v1/verify"` | `GOTRUE_MAILER_URLPATHS_*` |

**Kong exposure** ([docker/volumes/api/kong.yml](https://github.com/supabase/supabase/blob/master/docker/volumes/api/kong.yml)): a few auth routes are open with no API key — `auth-v1-open` (`/auth/v1/verify`), `auth-v1-open-callback` (`/auth/v1/callback`), `auth-v1-open-authorize` (`/auth/v1/authorize`), plus JWKS and SAML routes. Everything else under `/auth/v1/*` (including `/signup`, `/token`) goes through `key-auth` + ACL, satisfied by the **anon (publishable) key** — which ships in the frontend bundle, so with `DISABLE_SIGNUP=false` anyone on the internet can hit `/auth/v1/signup`. That's what "open signup" means operationally: abuse controls (§4) become load-bearing.

## 2. Email confirmation + SMTP

Key vars ([README](https://github.com/supabase/auth/blob/master/README.md), [example.env](https://github.com/supabase/auth/blob/master/example.env)):

- `GOTRUE_MAILER_AUTOCONFIRM` — "If you do not require email confirmation, you may set this to `true`. Defaults to `false`." (`true` = users are signed in without a confirmation email.)
- `GOTRUE_SMTP_HOST` / `GOTRUE_SMTP_PORT` (default 587) / `GOTRUE_SMTP_USER` / `GOTRUE_SMTP_PASS` / `GOTRUE_SMTP_ADMIN_EMAIL` ("The `From` email address for all emails sent") / `GOTRUE_SMTP_SENDER_NAME`, plus `GOTRUE_SMTP_MAX_FREQUENCY` (example.env: `5s`).
- `GOTRUE_MAILER_URLPATHS_CONFIRMATION` / `_INVITE` / `_RECOVERY` / `_EMAIL_CHANGE` — paths appended to `API_EXTERNAL_URL` in email links; the docker `.env.example` sets all four to `"/auth/v1/verify"` (the Kong-open verify route).

**Is SMTP strictly required?**

- Not at boot: in [configuration.go](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go), `SMTPConfiguration.Validate()` only precomputes the From address and headers and `return nil` — GoTrue starts fine with empty SMTP vars (the docker `.env.example` even ships fake placeholders: `SMTP_HOST=supabase-mail`, `SMTP_USER=fake_mail_user`).
- The README is explicit: "Sending email is not required, but highly recommended for password recovery."
- **Email signup + `GOTRUE_MAILER_AUTOCONFIRM=true`**: signup itself sends no email, so it works without SMTP. But any endpoint that *does* send email — `/recover` (password reset), `/magiclink`, `/otp` (email), `/invite`, email change, resend — will fail at request time. So "no SMTP" is only safe if the UI never offers those flows.
- **OAuth-only (Google) with `GOTRUE_EXTERNAL_EMAIL_ENABLED=false`**: no SMTP needed. Email signup/magic-link sign-in are disabled by the provider flag; Google users have no password, so recovery is moot; invites (`POST /invite`, service-role only) and `updateUser({email})` email-change confirmations are the residual email paths — they'd error without SMTP, but a Google-only app simply doesn't expose them. Autoconfirm is irrelevant because Google-verified emails arrive confirmed.

**SMTP providers at hobby scale** (from providers' own pricing pages, 2026-07-16):

| Provider | Free tier | First paid tier |
|---|---|---|
| [Resend](https://resend.com/pricing) | 3,000 emails/mo, capped 100/day, 1 domain | $20/mo → 50,000/mo, no daily cap |
| [Brevo](https://www.brevo.com/pricing/) ([limits FAQ](https://help.brevo.com/hc/en-us/articles/208580669)) | 300 emails/day forever-free (Brevo branding on emails) | Starter from ~$9/mo → 5,000/mo |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) | New accounts since 2025-07-15 get $200 general Free Tier credits for 6 months (older offer: 3,000 message charges/mo for 12 months); afterwards pay-as-you-go | $0.10 per 1,000 outbound emails (cheapest at any scale; requires production-access request) |
| [Mailgun](https://www.mailgun.com/pricing/) | 100 emails/day | Basic $15/mo → 10,000/mo |
| [Postmark](https://postmarkapp.com/pricing) | 100 emails/mo (dev plan, no overages) | $15/mo → 10,000/mo |
| [SMTP2GO](https://www.smtp2go.com/pricing/) | 1,000 emails/mo, 200/day cap | Starter $10/mo (or $100/yr) → 10,000/mo |

Any of the true free tiers (Resend, Brevo, SMTP2GO) comfortably covers a hobby app's auth email volume; SES is the cheapest if you already have AWS.

## 3. Google OAuth for arbitrary public users on self-hosted

GoTrue vars ([example.env](https://github.com/supabase/auth/blob/master/example.env), [README](https://github.com/supabase/auth/blob/master/README.md)):

- `GOTRUE_EXTERNAL_GOOGLE_ENABLED=true`
- `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` / `GOTRUE_EXTERNAL_GOOGLE_SECRET` — from a Google Cloud OAuth 2.0 Web application client.
- `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI` — "The URI a OAuth2 provider will redirect to with the `code` and `state` values" (README). On a self-hosted stack this must be the **Kong-exposed API domain + `/auth/v1/callback`**, i.e. for this project:

  ```
  GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://api.notifier.yoshevbot.uk/auth/v1/callback
  ```

  The [Supabase Google login guide](https://supabase.com/docs/guides/auth/social-login/auth-google) confirms the registered redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback` on the platform and, for self-hosted, "replace the Supabase domain with your custom domain following the same path structure"; `kong.yml` routes `/auth/v1/callback` openly (no API key) precisely for this. Register that exact URL under **Authorized redirect URIs** in the Google client, and the app origin (`https://imdb-notifier-yoshev.netlify.app`) under Authorized JavaScript origins. Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (the guide warns that adding sensitive/restricted scopes "might be subject to verification").
- The user lands back on `GOTRUE_SITE_URL` (or an allow-listed `redirect_to`), so §1's `SITE_URL`/`URI_ALLOW_LIST` must include the Netlify app.

**Google consent screen — Testing vs In production** ([Google Auth Platform: manage app audience](https://support.google.com/cloud/answer/15549945)):

- **Testing**: "limited to up to 100 **test users** listed in the OAuth consent screen"; each test user sees a warning, and "authorizations by a test user will expire seven days from the time of consent" (exception: basic name/email/openid scopes don't expire). Not suitable for arbitrary public users.
- **In production**: status after clicking **Publish app**. Verification is only triggered if the app "meets one or more of the OAuth verification criteria" — i.e. requests **sensitive or restricted** scopes (or heavy branding/domain criteria). **Basic scopes (`openid`, `email`, `profile`) do not require verification** and don't show the warning.
- **Unverified-app screen + 100-user cap**: "Google will display an [Unverified apps] warning message if your project's OAuth clients request authorization of scopes considered sensitive or restricted", and such apps are capped at "100 new users in total, after the app presents the unverified app screen". Since Supabase sign-in only needs openid/email/profile, **publishing to production with basic scopes gives unlimited arbitrary Google users, no verification, no cap** — the consent screen just shows the app name/support email (logo display may require verification/branding review).

## 4. Abuse controls self-hosted

**Rate limits** — actual names from [internal/conf/configuration.go](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go) (prefix `GOTRUE_`, defaults in parentheses; configurable email/SMS limits landed in v2.163.0 per [CHANGELOG](https://github.com/supabase/auth/blob/master/CHANGELOG.md)):

- `GOTRUE_RATE_LIMIT_HEADER` — client-IP header for limiting, e.g. `X-Forwarded-For` ([example.env](https://github.com/supabase/auth/blob/master/example.env))
- `GOTRUE_RATE_LIMIT_EMAIL_SENT` (30/hr) — "Rate limit the number of emails sent per hour on the following endpoints: `/signup`, `/invite`, `/magiclink`, `/recover`, `/otp`, & `/user`" ([README](https://github.com/supabase/auth/blob/master/README.md))
- `GOTRUE_RATE_LIMIT_SMS_SENT` (30), `GOTRUE_RATE_LIMIT_OTP` (30), `GOTRUE_RATE_LIMIT_VERIFY` (30), `GOTRUE_RATE_LIMIT_TOKEN_REFRESH` (150), `GOTRUE_RATE_LIMIT_SSO` (30), `GOTRUE_RATE_LIMIT_ANONYMOUS_USERS` (30), `GOTRUE_RATE_LIMIT_WEB3` (30), `GOTRUE_RATE_LIMIT_PASSKEY` (30), `GOTRUE_RATE_LIMIT_O_AUTH_DYNAMIC_CLIENT_REGISTER` (10)
- There is **no** `GOTRUE_RATE_LIMIT_SIGNUPS` var; password-signup pressure is bounded indirectly by `EMAIL_SENT` (when confirmations are on) and by captcha.

**Captcha** ([example.env](https://github.com/supabase/auth/blob/master/example.env), [configuration.go](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go), [captcha guide](https://supabase.com/docs/guides/auth/auth-captcha)):

- `GOTRUE_SECURITY_CAPTCHA_ENABLED=true`, `GOTRUE_SECURITY_CAPTCHA_PROVIDER` = `hcaptcha` (default) or `turnstile`, `GOTRUE_SECURITY_CAPTCHA_SECRET`, `GOTRUE_SECURITY_CAPTCHA_TIMEOUT` (10s). Validation enforces a non-empty secret and one of the two providers.
- Protects sign-up, sign-in and password-reset (and OTP/passkey) request paths; the client passes `options.captchaToken` from the hCaptcha/Turnstile widget. Google OAuth redirects are not captcha-gated (Google itself is the gate).

**Disposable-email blocking**: nothing native. The supported mechanism is the **`before_user_created` hook** — "inspect the incoming user object and optionally reject the request", with documented use cases of "blocking disposable email domains, restricting access by region or IP" ([Before User Created Hook docs](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)). Self-hosted env vars follow the `ExtensibilityPointConfiguration` pattern in configuration.go: `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED` / `_URI` (HTTP endpoint or `pg-functions://` URI) / `_SECRETS`. **Version requirement: supabase/auth ≥ v2.175.0** (CHANGELOG 2025-06-03: "add before-user-created hook (#2034)"); the docker compose currently pins `supabase/gotrue:v2.189.0`, so a reasonably fresh self-hosted stack has it. Other hooks: `SEND_EMAIL`, `SEND_SMS`, `CUSTOM_ACCESS_TOKEN`, `MFA_VERIFICATION_ATTEMPT`, `PASSWORD_VERIFICATION_ATTEMPT`, `AFTER_USER_CREATED`.

**Per-user quotas**: not a GoTrue feature. Enforce at other layers — Postgres (RLS policies / triggers counting rows per `auth.uid()`), PostgREST-visible constraints, or Kong rate-limiting plugins in `kong.yml` for request-level throttling.

## 5. RLS / anon (short)

The `anon` Postgres role is what PostgREST uses for requests bearing only the anon/publishable key (no user JWT). For public read-only tables: `grant select on <table> to anon;` plus a policy like `create policy public_read on <table> for select to anon using (true);` — RLS denies by default, so both the grant and the policy are needed. Cautions: the anon key is public by design, so an anon `select` policy means **anyone with the API URL can read those rows** (and enumerate the table via PostgREST); never add anon write policies casually, and remember `authenticated` policies apply to *every* signed-up user — which, with open signup, is any stranger. That is exactly this repo's current gap: `using (true)` UPDATE policies `to authenticated` on lists/settings.

## Recommended signup setup (this project)

For a hobby-scale public radar app with the Google button already built, the cheapest-to-operate and lowest-abuse-surface configuration is **Google-OAuth-only open signup, no SMTP**:

1. **Fix RLS first** (blocker): before flipping any signup switch, tighten `supabase/migrations` policies — add `owner`/`user_id` columns (or an admin allow-list) so lists/settings are only writable by their owner or by `vasil.yoshev@gmail.com`'s user id; keep read `to authenticated` (or `to anon` if the radar should be viewable without login). Today any new signup could rewrite lists/settings.
2. **GoTrue env on the prod stack** (`api.notifier.yoshevbot.uk`):
   - `GOTRUE_DISABLE_SIGNUP=false` (supersedes SPEC §13's single-user plan if going public)
   - `GOTRUE_EXTERNAL_EMAIL_ENABLED=false` (`ENABLE_EMAIL_SIGNUP=false` in the docker `.env`) and `ENABLE_PHONE_SIGNUP=false` → no password/magic-link/OTP surface, so **no SMTP provider needed at all**
   - `GOTRUE_SITE_URL=https://imdb-notifier-yoshev.netlify.app` (or the future custom domain), `GOTRUE_URI_ALLOW_LIST` covering any preview/alternate origins, `API_EXTERNAL_URL=https://api.notifier.yoshevbot.uk`
   - `GOTRUE_EXTERNAL_GOOGLE_ENABLED=true`, `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`, `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://api.notifier.yoshevbot.uk/auth/v1/callback`
3. **Google Cloud**: Web OAuth client with that redirect URI; consent screen with only `openid`/`email`/`profile`; **Publish app** (In production). No verification, no 100-user cap with basic scopes; "Testing" would cap you at 100 hand-listed test users with 7-day consent expiry.
4. **Abuse controls**: defaults are mostly fine because Google gates account creation. Keep `GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For` correct behind the reverse proxy so limits key on real client IPs. Captcha and SMTP-dependent limits are unnecessary while email signup is off. If email signup is ever enabled later: add Turnstile (`GOTRUE_SECURITY_CAPTCHA_*`), keep `GOTRUE_MAILER_AUTOCONFIRM=false` with a free SMTP tier (Brevo 300/day or Resend 3,000/mo), set `GOTRUE_RATE_LIMIT_EMAIL_SENT` low (single digits/hr), and wire `GOTRUE_HOOK_BEFORE_USER_CREATED_*` (stack is on v2.189.0 ≥ v2.175.0) for disposable-domain blocking.
5. **Per-user quotas** (e.g. max lists per user) belong in Postgres constraints/RLS, not GoTrue.
