# IMDb Digital Release Notifier

Single-user tool that watches Vasil's public IMDb watchlist and announces theatrical and digital releases. This glossary is the ubiquitous language for the Netlify + Supabase rework.

## Language

### Titles

**Movie**:
The core tracked entity — a feature film from the watchlist, identified by its IMDb id. Non-movie watchlist items (series, games) are not part of the domain.
_Avoid_: Title, item, film

**Watchlist**:
The public IMDb list that is the single source of what is tracked. Membership on it is the only way a Movie enters or leaves tracking.

**Unmatched Movie**:
A Movie whose IMDb id has no TMDb mapping yet. It exists and is visible, but has no dates or providers until a later refresh matches it.

**On-watchlist / Removed**:
A Movie's membership state. Removal hides it and stops refreshing and notifying it, but never deletes it; re-adding restores it with its history intact.

### Releases

**Medium**:
The release channel of an event or date: theatrical or digital. Every date and every release event belongs to exactly one medium.
_Avoid_: Type, channel

**Raw Release Date**:
A date as fetched from the source for one (region, medium) pair. Replaced wholesale on every refresh; never notified from directly.

**Effective Date**:
The date the system acts on for a (Movie, medium): the first raw date found walking the region order. All notifications and status derivations use effective dates only.
_Avoid_: Release date (ambiguous), final date

**Region Order**:
The ordered list of regions (default BG → US → GB) used to pick the effective date and rank provider display.
_Avoid_: Fallback chain, region preference

### Notifications

**Release Event**:
A notable fact about a (Movie, medium): announced (a future effective date first appears), released (the effective date is reached), or date changed (an already-announced effective date moves before release).
_Avoid_: Alert, update

**Notification Log**:
The append-only record of every Release Event ever produced. It is the dedupe state — rows are never deleted — and doubles as the visible history feed.
_Avoid_: Known items, sent list

**Seeded Event**:
A log row created silently for a fact that was already in the past when its Movie was first observed (or while paused). Counts as notified for dedupe, but was never sent and is hidden from history.

**Digest**:
The single email summarizing all of one Refresh Run's sent events. Push, by contrast, is one notification per event.

### Operation

**Refresh Run**:
One execution of the pipeline (fetch watchlist → match → fetch dates/providers → detect events → notify), triggered by cron or manually. Every run is recorded.
_Avoid_: Sync, check

**Gate Hour**:
The configured local hour (Europe/Sofia) at which the hourly cron actually runs the pipeline. Manual runs bypass the gate.
_Avoid_: Schedule, send time

**Paused**:
Settings state in which runs still refresh data and seed the log, but nothing is sent.

### Derived statuses (UI language, never stored)

**Unmatched** → **Waiting** (matched, no effective dates) → **Announced** (future date known) → **In theaters** (theatrical released, digital not) → **Out now** (digital released).
