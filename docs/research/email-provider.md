# Email API provider for the Supabase Edge Function

**Research ticket:** [#5](https://github.com/vasilyoshev/imdb-digital-release-notifier/issues/5)
**Date verified:** 2026-07-15 (all claims checked against providers' current official docs/pricing pages)

## Context

The notifier sends a handful of emails per week to a single Gmail recipient, triggered from a
Supabase Edge Function (Deno). That means the provider must be usable via a plain HTTPS `fetch`
with a JSON body and an API key — no Node SDK, no SMTP. Sending domain is `yoshevbot.uk` with
DNS on Cloudflare.

## Comparison

| Provider | Free tier today | Custom domain on free tier | Deno `fetch` ergonomics | Approval friction | Verdict |
|---|---|---|---|---|---|
| **Resend** | 3,000/mo (100/day cap), permanent, 1 domain ([pricing](https://resend.com/pricing)) | Yes — SPF + DKIM (+ return-path MX on `send.` subdomain); [dedicated Cloudflare guide](https://resend.com/docs/knowledge-base/cloudflare) incl. "DNS Only" proxy warning and one-click Domain Connect | Best: `POST https://api.resend.com/emails`, `Authorization: Bearer`, JSON body — [the official Supabase Edge Functions email example](https://supabase.com/docs/guides/functions/examples/send-emails) | None found | **Winner** |
| **Postmark** | 100/mo, permanent, no card, no overages ([pricing](https://postmarkapp.com/pricing)) | Yes — 1 DKIM TXT + 1 Return-Path CNAME, no separate SPF needed ([domain verification](https://postmarkapp.com/support/article/1046-how-do-i-verify-a-domain)) | Very good: JSON POST with `X-Postmark-Server-Token` header ([email API](https://postmarkapp.com/developer/api/email-api)) | Manual account review before sending to external domains ([approval process](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work)); anecdotal reports of small personal accounts being declined | Strong runner-up |
| **Brevo** | 300/day, "free forever", no card ([pricing](https://www.brevo.com/pricing/)) | Yes — Brevo DKIM + verification TXT + DMARC | Good: `POST https://api.brevo.com/v3/smtp/email`, `api-key` header, JSON ([docs](https://developers.brevo.com/docs/send-a-transactional-email)) | Sending-approval step ("Once we approve your account for sending…"); **free-plan emails carry a "Sent by Brevo" footer** (removal is a €8.10/mo add-on) | OK, footer hurts |
| **SendGrid** | **None** — free plan retired starting 2025-05-27, sending paused on free accounts ([Twilio changelog](https://www.twilio.com/en-us/changelog/sendgrid-free-plan)); 60-day trial then ~$19.95/mo Essentials | n/a | JSON + Bearer | n/a | **Eliminated** |
| **Mailgun** | "Free" 100/day exists ([pricing](https://www.mailgun.com/pricing/)), but docs FAQ: "Free accounts do not include the ability to create a custom domain" — sandbox sends only to pre-authorized recipients ([FAQ](https://documentation.mailgun.com/docs/mailgun/faq/faqs)) | Effectively no | Worst of the group: HTTP **Basic** auth (`btoa('api:'+key)`) and **form-encoded** body, not JSON ([send docs](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-http)) | Card on file needed to lift restrictions | **Eliminated** |
| **Amazon SES** (considered) | 3,000 msgs/mo free **for first 12 months only**, then $0.10/1k ([pricing](https://aws.amazon.com/ses/pricing/)) | Yes | Worst ergonomics: HTTP API requires AWS SigV4 request signing — no plain key header | Sandbox by default; manual production-access request to send to Gmail ([docs](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)) | Overkill |

## Notes per criterion

### 1. Free-tier reality check (things have changed)

- **SendGrid's free tier is dead.** Twilio's official changelog confirms retirement began
  May 27, 2025: "Email sending will be paused for accounts on all free plans" and "an upgrade
  to a paid plan will be required to continue sending email."
- **Mailgun's free tier is test-grade** — sandbox domain, pre-authorized recipients only;
  their own FAQ says free accounts can't create a custom domain.
- Resend (3,000/mo), Postmark (100/mo), and Brevo (300/day) all still have permanent free
  tiers that comfortably cover ~20 emails/month.

### 2. Custom domain (yoshevbot.uk) on Cloudflare

All viable providers support custom-domain sending on their free tier. The universal
Cloudflare gotcha: verification/DKIM/return-path records must be **DNS-only, not proxied**
(proxied CNAMEs resolve to Cloudflare IPs and break verification —
[Cloudflare docs](https://developers.cloudflare.com/dns/manage-dns-records/troubleshooting/cname-domain-verification/)).
Resend is the only one with a [first-party Cloudflare guide](https://resend.com/docs/knowledge-base/cloudflare)
spelling out the exact records (MX + SPF TXT on `send`, DKIM TXT on `resend._domainkey`) and
the DNS-only requirement, plus one-click Domain Connect setup.

### 3. API from Deno fetch

Resend is a single JSON POST with a Bearer key — and it is literally
[the example in Supabase's own Edge Functions docs](https://supabase.com/docs/guides/functions/examples/send-emails):

```ts
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
  },
  body: JSON.stringify({
    from: "IMDb Notifier <notifier@yoshevbot.uk>",
    to: ["vasil.yoshev@gmail.com"],
    subject: "New digital releases",
    html: "...",
  }),
});
```

Postmark and Brevo are equally simple JSON POSTs with a custom auth header. Mailgun needs
Basic auth plus a form-encoded body; SES needs SigV4 signing.

### 4. Deliverability to Gmail for a tiny sender

Postmark has the strongest reputation (qualitative consensus; they also enforce it via manual
account approval). Resend is younger (2023) with a decent shared pool and no widespread
complaints found. Brevo shares infrastructure with bulk marketing senders (a notch below,
anecdotally). At ~5 emails/week to one recipient who can whitelist the sender, any of the
three is fine once SPF/DKIM/DMARC are set on yoshevbot.uk.

## Recommendation: **Resend**

1. **Free tier fits with ~100x headroom** — 3,000/mo permanent, custom domain included.
2. **Path of least resistance in this exact stack** — Supabase's official Edge Functions
   email guide is a Deno `fetch` to `api.resend.com` with a Bearer key; copy-paste distance
   from working code.
3. **Best Cloudflare story** — first-party guide with the exact DNS records for
   yoshevbot.uk and the proxy-off warning; optional one-click setup.
4. **No approval gate** — unlike Postmark (manual review, small personal accounts sometimes
   declined), Brevo (sending approval + branded footer), and SES (sandbox escape request).

**Fallback:** Postmark, if deliverability ever becomes a problem — best-in-class reputation
and its permanent 100/mo covers this volume, at the cost of passing manual account approval
first.
