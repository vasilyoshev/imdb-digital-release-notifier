# IMDb Digital Release Notifier

Public, multi-tenant web app that tracks theatrical and digital movie releases: anonymous visitors get the Digital Release Radar; signed-in Users sync an IMDb watchlist and follow movies; notifications go out per user. This glossary is the ubiquitous language for the v2 (public Console) spec.

## Language

### People & tiers

**User**:
Anyone with an account (Google signup). Owns their own Lists, Settings, push subscriptions, and Deliveries.
_Avoid_: Member, account (for the person)

**Owner**:
The single User with `role = owner` (Vasil). Everything a User has, plus email digests, the full-pipeline refresh trigger, and Refresh Run visibility. A role on a profile, not a separate model.
_Avoid_: Admin, superuser

**Anonymous visitor**:
No account. Sees the Radar (read-only, region-selectable) and the signup funnels (search box, Follow buttons).

### Titles & lists

**Movie**:
The core tracked entity — a feature film identified by its IMDb id, its TMDb id, or both (at least one). One shared row serves everyone; movie data is global, never per-user. Non-movie items (series, games) are not part of the domain.
_Avoid_: Title, item, film

**List**:
A per-User collection of Movies. Two kinds: `imdb_watchlist` (auto-synced from IMDb) and `manual` (movies the User followed or added). Each List has sync and notifications toggles. Membership on Lists is the only way a Movie enters or leaves a User's tracking.
_Avoid_: Feed, source, collection

**Watchlist**:
A User's List of kind `imdb_watchlist`, synced from their public IMDb watchlist.

**Followed list**:
The manual List every User gets automatically at signup. Follow = a Membership row in it; Unfollow removes the row. Users can create more manual lists later (model supports it; UI deferred).

**Follow**:
The one-click act of adding a Movie to the Followed list — from search results, the Radar, or the detail panel. Following an untracked Movie hydrates it from TMDB immediately.

**Membership / Active Movie**:
A Movie's soft per-List state (`on_list`). Dropping off a List hides that membership but never deletes anything; returning restores it with history intact. A Movie is Active while it is on at least one List of any User — Active Movies are refreshed by user sync; Radar Movies refresh via the radar job.

**Unmatched Movie**:
A Movie with an IMDb id but no TMDb mapping yet. Visible, but has no dates or providers until a later refresh matches it.

### The Radar

**Digital Release Radar (Radar)**:
The public, shared view of digital releases: recently released on digital + upcoming digital, per region. Computed once by cron for all supported regions; served to anonymous visitors, signed-in Users (as the first switcher tab), and the Stremio addon. Replaces the v1 per-user Popular list.
_Avoid_: Popular list, discover list

**Radar Entry**:
One cron-computed Radar row: (region, window recent|upcoming, Movie, rank, digital date). Read-only for all clients; never written by users.

**Supported Regions**:
The curated app-level set of regions (~10–20, seeded with BG/US/GB + majors) the pipeline hydrates and the Radar covers. Extended on request.

**Region Cascade**:
A User's ordered subset of the Supported Regions (default BG → US → GB) used to pick their effective dates and rank provider display. The pipeline hydrates the union of all chosen regions.
_Avoid_: Region order (v1 term), fallback chain

### Releases

**Medium**:
The release channel of an event or date: theatrical or digital. Every date and every release event belongs to exactly one medium.
_Avoid_: Type, channel

**Raw Release Date**:
A date as fetched from TMDB for one (region, medium) pair. Replaced wholesale on every refresh; never notified from directly.

**Effective Date**:
The date the system acts on for a (Movie, medium): the first raw date found walking a Region Cascade. All notifications and status derivations use effective dates only.
_Avoid_: Release date (ambiguous), final date

### Notifications

**Movie Event**:
A notable global fact about a (Movie, medium), detected once by the pipeline for everyone: announced (a future effective date first appears), released (the effective date is reached), or date changed (an already-announced effective date moves before release). Append-only; the stream is the dedupe state and is never pruned.
_Avoid_: Alert, update, notification (for the fact itself)

**Seeded Event**:
A Movie Event recorded for a fact already in the past when its Movie was first observed. Counts for dedupe, is never delivered to anyone, hidden from history.

**Delivery**:
A per-User record that a Movie Event was sent to them on one channel (push, email). Detection is global; Delivery is per-User. History feed = events for Movies you follow, with your delivery status.
_Avoid_: Notification log (v1 term — split into Movie Events + Deliveries)

**Delivery Gating**:
Detection always runs and always logs. An event is delivered to a User only if: it is not seeded, it was created after the Membership's `added_at` (following an already-tracked Movie never replays history), the Movie sits on at least one of their notifications-enabled Lists, and they are not Paused.

**Digest**:
The single email summarizing one delivery batch's sent events — Owner only. Push, by contrast, is one notification per event, for all Users.

### Operation

**Refresh Run**:
One recorded execution of a pipeline job: `full` (daily: sync all lists, hydrate the movie union, compute the Radar, detect events), `tick` (hourly: re-hydrate TMDB-reported changes), `delivery` (hourly: send to users at their local gate hour), or `user_refresh` (a User's scoped Refresh-now).
_Avoid_: Sync (for the whole run), check

**Gate Hour**:
A User's configured local hour — in their own IANA timezone — at which the hourly delivery job sends to them. Data refresh no longer gates on it.
_Avoid_: Schedule, send time

**Paused**:
Per-User settings state in which their deliveries are suppressed while detection continues. Per-List notifications toggles gate the same way, scoped to one List's Movies.

**Shared cache**:
The system-wide dedupe of TMDB hydration: one bundle call per Movie per `refreshed_at` window, shared across the Radar and every User's lists.

### Derived statuses (UI language, never stored)

**Unmatched** → **Waiting** (matched, no effective dates) → **Announced** (future date known) → **In theaters** (theatrical released, digital not) → **Out now** (digital released).
