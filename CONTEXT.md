# IMDb Digital Release Notifier

Single-user tool that tracks movies on auto-synced lists (Vasil's public IMDb watchlist, a TMDb-Discover Popular list) and announces theatrical and digital releases. This glossary is the ubiquitous language for the Netlify + Supabase rework.

## Language

### Titles & lists

**Movie**:
The core tracked entity — a feature film identified by its IMDb id, its TMDb id, or both (at least one). Non-movie items (series, games) are not part of the domain.
_Avoid_: Title, item, film

**List**:
An auto-synced source of Movies. Two kinds: an IMDb watchlist (synced from IMDb) and a TMDb Discover list (synced from a filter query). Each List has its own sync toggle and notifications toggle. Membership on Lists is the only way a Movie enters or leaves tracking.
_Avoid_: Feed, source, collection

**Watchlist**:
The List of kind `imdb_watchlist` — Vasil's public IMDb watchlist.

**Popular list**:
The List of kind `tmdb_discover` — the top N results of a configurable TMDb Discover filter (default: by popularity, N=50).

**Membership / Active Movie**:
A Movie's soft per-List state (`on_list`). Dropping off a List hides that membership but never deletes anything; returning restores it with history intact. A Movie is Active while it is on at least one List — only Active Movies are refreshed, shown by default, and eligible for delivery.

**Unmatched Movie**:
A Movie with an IMDb id but no TMDb mapping yet. It exists and is visible, but has no dates or providers until a later refresh matches it.

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
The append-only record of every Release Event ever produced. It is the dedupe state — rows are never deleted — and doubles as the visible history feed. Dedupe is global per Movie: being on several Lists never double-notifies.
_Avoid_: Known items, sent list

**Seeded Event**:
A log row created silently for a fact that was already in the past when its Movie was first observed, or produced while Paused, or while no List containing the Movie had notifications enabled. Counts as notified for dedupe, but was never sent and is hidden from history.

**Delivery Gating**:
Detection always runs and always logs; an event is delivered only if the Movie sits on at least one notifications-enabled List and global Pause is off.

**Digest**:
The single email summarizing all of one Refresh Run's sent events. Push, by contrast, is one notification per event.

### Operation

**Refresh Run**:
One execution of the pipeline (sync lists → match → fetch dates/providers → detect events → notify), triggered by cron or manually. Every run is recorded.
_Avoid_: Sync (for the whole run), check

**Gate Hour**:
The configured local hour (Europe/Sofia) at which the hourly cron actually runs the pipeline. Manual runs bypass the gate.
_Avoid_: Schedule, send time

**Paused**:
Global settings state in which runs still refresh data and seed the log, but nothing is sent. Per-List notifications toggles gate the same way, scoped to one List's Movies.

### Derived statuses (UI language, never stored)

**Unmatched** → **Waiting** (matched, no effective dates) → **Announced** (future date known) → **In theaters** (theatrical released, digital not) → **Out now** (digital released).
