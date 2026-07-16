# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Supabase backend of the release notifier — schema, RLS, and the Edge Function pipeline (list sync → TMDb refresh → event detection → email/push) — developed and verified against a local `supabase start` Docker stack.

**Architecture:** One Postgres schema (movies + first-class lists + append-only notification log) and one Deno Edge Function (`refresh`) that runs the whole pipeline per `docs/SPEC.md` (amended 2026-07-15). Pure logic (effective dates, event detection, response parsing, digest building) lives in small modules with Deno unit tests; I/O lives in thin `db.ts`/HTTP wrappers exercised by a local end-to-end run.

**Tech Stack:** Supabase (Postgres 17, Auth, Edge Functions/Deno, pg_cron, pg_net, Vault), TypeScript, `jsr:@negrel/webpush`, Resend HTTP API, TMDb v3 API, IMDb unauthenticated GraphQL. Tooling via npm dev-deps: `supabase` (CLI), `deno` (runtime for tests).

## Global Constraints

- Spec is `docs/SPEC.md` on `main` (amended 2026-07-15); glossary is `CONTEXT.md`. Terms used here (List, Membership, Effective Date, Seeded Event, Delivery Gating, Refresh Run, Gate Hour) are defined there.
- Region order default: `{BG,US,GB}`. Gate hour default: `9` (Europe/Sofia). List seed rows: Watchlist (`imdb_user_id: ur27331503`), Popular (`sort_by: popularity.desc`, `vote_count.gte: 100`, `limit: 50`).
- TMDb release types: `3` → `theatrical`, `4` → `digital`; earliest date wins per (region, medium); all other types ignored.
- Event kinds stored as `announced` / `released` / `date_changed` + a `medium` column (spec's `theatrical_announced` = `medium='theatrical', event='announced'`).
- `notification_log` is append-only; `sent_at NULL` = silent (seeded / paused / no notifications-enabled list). Never delete rows.
- Dates are compared as `YYYY-MM-DD` strings (lexicographic = chronological).
- All date "today"/hour logic uses `Europe/Sofia` via `Intl` (never the server's local zone).
- The IMDb GraphQL query is unofficial: it must stay isolated in `supabase/functions/refresh/lib/imdb.ts`.
- Branch: `rebuild`, in a worktree, from `origin/main`. The old Next.js app stays untouched on the branch (the frontend plan replaces it later).
- Commits: conventional prefixes (`feat:`, `test:`, `chore:`), each ending with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Node ≥ 24 and Docker are already installed; `deno` and `supabase` are NOT globally installed — always invoke via `npx` from the repo root.
- Windows host: run commands in Git Bash (POSIX) unless noted; paths in commands are worktree-relative.

---

### Task 1: Worktree, tooling, Supabase scaffold

**Files:**
- Create: worktree at `../imdb-notifier-rebuild` on branch `rebuild`
- Modify: `package.json` (add devDependencies + scripts)
- Create: `supabase/config.toml` (via `supabase init`), `.gitignore` additions
- Create: `docs/superpowers/plans/2026-07-15-backend-foundation.md` (copy of this plan)

**Interfaces:**
- Produces: a worktree where `npx supabase --version` and `npx deno --version` work; all later tasks run inside it.

- [ ] **Step 1: Create the worktree**

```bash
cd /c/Users/vasil/Projects/imdb-digital-release-notifier
git fetch origin
git worktree add ../imdb-notifier-rebuild -b rebuild origin/main
cd ../imdb-notifier-rebuild
```
Expected: worktree created, branch `rebuild` tracking origin/main tip (contains `docs/SPEC.md` and `CONTEXT.md`).

- [ ] **Step 2: Copy this plan in and add tooling dev-deps**

```bash
mkdir -p docs/superpowers/plans
cp ../imdb-digital-release-notifier/docs/superpowers/plans/2026-07-15-backend-foundation.md docs/superpowers/plans/
npm install --save-dev supabase deno
```
Expected: `package.json` gains `"supabase"` and `"deno"` devDependencies; `npx supabase --version` prints a 2.x version; `npx deno --version` prints deno 2.x.

- [ ] **Step 3: Add npm scripts**

In `package.json`, add to `"scripts"`:

```json
"db:start": "supabase start",
"db:stop": "supabase stop",
"db:reset": "supabase db reset",
"fn:serve": "supabase functions serve refresh --env-file supabase/functions/.env --no-verify-jwt",
"test:fn": "deno test --allow-none supabase/functions"
```

(Note: `--no-verify-jwt` is for local serving only; the deployed function keeps JWT verification on. `test:fn` needs no permissions — all unit-tested code is pure.)

- [ ] **Step 4: Initialize Supabase project scaffold**

```bash
npx supabase init --force
```
Expected: `supabase/config.toml` created. Answer "n" to IntelliJ/VS Code settings prompts if asked (or pass `--with-intellij-settings=false --with-vscode-settings=false`).

- [ ] **Step 5: Gitignore local-only files**

Append to `.gitignore`:

```
# supabase local
supabase/.temp/
supabase/functions/.env
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold supabase project and local tooling (deno + supabase CLI as dev-deps)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Schema migration + seed + RLS

**Files:**
- Create: `supabase/migrations/20260715120000_schema.sql`

**Interfaces:**
- Produces: tables `movies`, `lists`, `list_memberships`, `release_dates`, `watch_providers`, `notification_log`, `push_subscriptions`, `settings`, `refresh_runs` exactly as below — every later task depends on these names/columns.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260715120000_schema.sql`:

```sql
-- Movies: one row per film ever tracked, never deleted. Identity may arrive
-- from IMDb (watchlist) or TMDb (discover); at least one id present.
create table public.movies (
  id bigint generated always as identity primary key,
  imdb_id text unique,
  tmdb_id integer unique,
  title text,
  year integer,
  poster_path text,
  theatrical_date date,
  theatrical_region text,
  digital_date date,
  digital_region text,
  created_at timestamptz not null default now(),
  check (imdb_id is not null or tmdb_id is not null)
);

create table public.lists (
  id integer generated always as identity primary key,
  kind text not null check (kind in ('imdb_watchlist','tmdb_discover')),
  name text not null,
  position integer not null default 0,
  sync_enabled boolean not null default true,
  notifications_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.list_memberships (
  list_id integer not null references public.lists(id) on delete cascade,
  movie_id bigint not null references public.movies(id) on delete cascade,
  on_list boolean not null default true,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (list_id, movie_id)
);

create table public.release_dates (
  movie_id bigint not null references public.movies(id) on delete cascade,
  region text not null,
  medium text not null check (medium in ('theatrical','digital')),
  release_date date not null,
  primary key (movie_id, region, medium)
);

create table public.watch_providers (
  movie_id bigint not null references public.movies(id) on delete cascade,
  region text not null,
  provider_id integer not null,
  offer_type text not null check (offer_type in ('flatrate','free','ads','rent','buy')),
  provider_name text not null,
  logo_path text,
  display_priority integer,
  link text,
  primary key (movie_id, region, provider_id, offer_type)
);

-- Append-only; sent_at NULL = seeded/paused/gated-silent. Never pruned.
create table public.notification_log (
  id bigint generated always as identity primary key,
  movie_id bigint not null references public.movies(id),
  medium text not null check (medium in ('theatrical','digital')),
  event text not null check (event in ('announced','released','date_changed')),
  effective_date date not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notification_log_once_ever
  on public.notification_log (movie_id, medium, event) where event <> 'date_changed';
create index notification_log_by_movie
  on public.notification_log (movie_id, medium, created_at desc);

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Singleton (id must be true, PK ⇒ at most one row).
create table public.settings (
  id boolean primary key default true check (id),
  region_order text[] not null default '{BG,US,GB}',
  notify_email text,
  notifications_paused boolean not null default false,
  notify_hour integer not null default 9 check (notify_hour between 0 and 23)
);

create table public.refresh_runs (
  id bigint generated always as identity primary key,
  trigger text not null check (trigger in ('cron','manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','error')),
  movies_total integer,
  movies_matched integer,
  events_created integer,
  notifications_sent integer,
  error text
);

-- Seed
insert into public.settings (id, notify_email) values (true, 'vasil.yoshev@gmail.com');
insert into public.lists (kind, name, position, config) values
  ('imdb_watchlist', 'Watchlist', 0, '{"imdb_user_id": "ur27331503"}'),
  ('tmdb_discover', 'Popular', 1,
   '{"filters": {"sort_by": "popularity.desc", "vote_count.gte": 100}, "limit": 50}');

-- RLS: role-based, no owner columns (single-account model).
-- authenticated: SELECT everything; write only settings, push_subscriptions,
-- and UPDATE lists (toggles + config). Pipeline uses service role (bypasses RLS).
alter table public.movies enable row level security;
alter table public.lists enable row level security;
alter table public.list_memberships enable row level security;
alter table public.release_dates enable row level security;
alter table public.watch_providers enable row level security;
alter table public.notification_log enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.settings enable row level security;
alter table public.refresh_runs enable row level security;

create policy movies_select on public.movies for select to authenticated using (true);
create policy lists_select on public.lists for select to authenticated using (true);
create policy lists_update on public.lists for update to authenticated using (true) with check (true);
create policy memberships_select on public.list_memberships for select to authenticated using (true);
create policy release_dates_select on public.release_dates for select to authenticated using (true);
create policy providers_select on public.watch_providers for select to authenticated using (true);
create policy log_select on public.notification_log for select to authenticated using (true);
create policy runs_select on public.refresh_runs for select to authenticated using (true);
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated using (true) with check (true);
create policy push_select on public.push_subscriptions for select to authenticated using (true);
create policy push_insert on public.push_subscriptions for insert to authenticated with check (true);
create policy push_delete on public.push_subscriptions for delete to authenticated using (true);
```

- [ ] **Step 2: Start the local stack and apply**

```bash
npm run db:start   # first run downloads Docker images — several minutes
npm run db:reset
```
Expected: `db reset` ends with `Finished supabase db reset`. Note the printed `API URL` (default `http://127.0.0.1:54321`), `anon key`, and `service_role key` — later tasks read them from `npx supabase status`.

- [ ] **Step 3: Verify schema + seeds**

```bash
echo "select (select count(*) from public.lists) as lists, (select count(*) from public.settings) as settings;" | npx supabase db psql 2>/dev/null || npx supabase status
```
If `db psql` is unavailable in this CLI version, use: `docker exec -i supabase_db_imdb-notifier-rebuild psql -U postgres -d postgres -c "select count(*) from public.lists;"` (container name from `docker ps`).
Expected: `lists = 2`, `settings = 1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat: schema, seeds, and RLS for lists-based release tracking

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Shared types + effective dates (`types.ts`, `dates.ts`)

**Files:**
- Create: `supabase/functions/refresh/lib/types.ts`
- Create: `supabase/functions/refresh/lib/dates.ts`
- Test: `supabase/functions/refresh/lib/dates_test.ts`

**Interfaces:**
- Produces: `computeEffective(raw: RawDate[], regionOrder: string[], medium: Medium): Effective | null`; `sofiaToday(now?: Date): string`; `sofiaHour(now?: Date): number`; and the shared types below used by every later module.

- [ ] **Step 1: Write `types.ts`** (no test — types only)

```ts
export type Medium = "theatrical" | "digital";

export interface RawDate {
  region: string;
  medium: Medium;
  date: string; // YYYY-MM-DD
}

export interface Effective {
  date: string; // YYYY-MM-DD
  region: string;
}

export interface WatchlistItem {
  imdbId: string;
  title: string;
  year: number | null;
}

export interface DiscoverItem {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
}

export interface ProviderRow {
  region: string;
  providerId: number;
  offerType: "flatrate" | "free" | "ads" | "rent" | "buy";
  providerName: string;
  logoPath: string | null;
  displayPriority: number | null;
  link: string | null;
}

export interface MovieBundle {
  title: string | null;
  year: number | null;
  posterPath: string | null;
  imdbId: string | null;
  rawDates: RawDate[];
  providers: ProviderRow[];
}
```

- [ ] **Step 2: Write the failing tests**

`supabase/functions/refresh/lib/dates_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { computeEffective, sofiaHour, sofiaToday } from "./dates.ts";
import type { RawDate } from "./types.ts";

const raw: RawDate[] = [
  { region: "US", medium: "digital", date: "2026-08-01" },
  { region: "GB", medium: "digital", date: "2026-07-20" },
  { region: "US", medium: "theatrical", date: "2026-05-01" },
];

Deno.test("first region in order wins even with a later date", () => {
  assertEquals(
    computeEffective(raw, ["BG", "US", "GB"], "digital"),
    { date: "2026-08-01", region: "US" },
  );
});

Deno.test("falls through regions without a date for the medium", () => {
  assertEquals(
    computeEffective(raw, ["BG", "GB", "US"], "digital"),
    { date: "2026-07-20", region: "GB" },
  );
});

Deno.test("null when no region has the medium", () => {
  assertEquals(computeEffective(raw, ["BG"], "digital"), null);
  assertEquals(computeEffective([], ["BG", "US", "GB"], "theatrical"), null);
});

Deno.test("sofiaToday formats as YYYY-MM-DD in Europe/Sofia", () => {
  // 2026-01-05T22:30Z is 2026-01-06 00:30 in Sofia (UTC+2, winter)
  assertEquals(sofiaToday(new Date("2026-01-05T22:30:00Z")), "2026-01-06");
});

Deno.test("sofiaHour uses h23 in Europe/Sofia", () => {
  // 06:00Z in July = 09:00 Sofia (UTC+3, summer)
  assertEquals(sofiaHour(new Date("2026-07-15T06:00:00Z")), 9);
  // 22:30Z in January = 00:30 Sofia next day
  assertEquals(sofiaHour(new Date("2026-01-05T22:30:00Z")), 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:fn`
Expected: FAIL — `Module not found ... dates.ts`.

- [ ] **Step 4: Implement `dates.ts`**

```ts
import type { Effective, Medium, RawDate } from "./types.ts";

export function computeEffective(
  raw: RawDate[],
  regionOrder: string[],
  medium: Medium,
): Effective | null {
  for (const region of regionOrder) {
    const hit = raw.find((d) => d.medium === medium && d.region === region);
    if (hit) return { date: hit.date, region };
  }
  return null;
}

export function sofiaToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Sofia" });
}

export function sofiaHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Sofia",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:fn` — Expected: all `dates_test.ts` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions
git commit -m "feat: shared types and effective-date computation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Event detection (`events.ts`)

**Files:**
- Create: `supabase/functions/refresh/lib/events.ts`
- Test: `supabase/functions/refresh/lib/events_test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `detectMediumEvents(input: DetectInput): DetectedEvent[]` with `MediumLogState { announcedEver: boolean; releasedEver: boolean; lastLoggedDate: string | null }`. `DetectedEvent.pastFactOnFirstObservation` tells the orchestrator to seed silently; global pause / list gating silence is the orchestrator's job, not this module's.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/refresh/lib/events_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { detectMediumEvents, type MediumLogState } from "./events.ts";

const TODAY = "2026-07-15";
const clean: MediumLogState = { announcedEver: false, releasedEver: false, lastLoggedDate: null };

Deno.test("no effective date → no events", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: null, state: clean, isNewMovie: true, today: TODAY }),
    [],
  );
});

Deno.test("future date, never announced → announced (notifiable even for new movies)", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-09-01", state: clean, isNewMovie: true, today: TODAY }),
    [{ event: "announced", effectiveDate: "2026-09-01", pastFactOnFirstObservation: false }],
  );
});

Deno.test("past date on a NEW movie → released, seeded silent", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: "2020-01-01", state: clean, isNewMovie: true, today: TODAY }),
    [{ event: "released", effectiveDate: "2020-01-01", pastFactOnFirstObservation: true }],
  );
});

Deno.test("date equal to today on a NEW movie → released, NOT silent (present fact)", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: TODAY, state: clean, isNewMovie: true, today: TODAY }),
    [{ event: "released", effectiveDate: TODAY, pastFactOnFirstObservation: false }],
  );
});

Deno.test("past date appearing on a KNOWN movie → released fires (announced suppressed same-run)", () => {
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-07-10", state: clean, isNewMovie: false, today: TODAY }),
    [{ event: "released", effectiveDate: "2026-07-10", pastFactOnFirstObservation: false }],
  );
});

Deno.test("announced date arriving (≤ today) → released once", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-07-15" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-07-15", state, isNewMovie: false, today: TODAY }),
    [{ event: "released", effectiveDate: "2026-07-15", pastFactOnFirstObservation: false }],
  );
});

Deno.test("released ever → nothing more, even if the date moves", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: true, lastLoggedDate: "2026-07-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-12-01", state, isNewMovie: false, today: TODAY }),
    [],
  );
});

Deno.test("announced date moved (future→future) → date_changed", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-09-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-10-01", state, isNewMovie: false, today: TODAY }),
    [{ event: "date_changed", effectiveDate: "2026-10-01", pastFactOnFirstObservation: false }],
  );
});

Deno.test("moved earlier also fires date_changed", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-10-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-08-20", state, isNewMovie: false, today: TODAY }),
    [{ event: "date_changed", effectiveDate: "2026-08-20", pastFactOnFirstObservation: false }],
  );
});

Deno.test("same date as last logged → silence (flap A→B→A across days re-notifies; same date doesn't)", () => {
  const state: MediumLogState = { announcedEver: true, releasedEver: false, lastLoggedDate: "2026-09-01" };
  assertEquals(
    detectMediumEvents({ currentEffective: "2026-09-01", state, isNewMovie: false, today: TODAY }),
    [],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fn` — Expected: FAIL — `Module not found ... events.ts`.

- [ ] **Step 3: Implement `events.ts`**

```ts
export type EventKind = "announced" | "released" | "date_changed";

export interface MediumLogState {
  announcedEver: boolean;
  releasedEver: boolean;
  /** effective_date of the most recent log row for (movie, medium), any kind incl. seeded */
  lastLoggedDate: string | null;
}

export interface DetectInput {
  currentEffective: string | null;
  state: MediumLogState;
  isNewMovie: boolean;
  today: string;
}

export interface DetectedEvent {
  event: EventKind;
  effectiveDate: string;
  /** true = past fact at first observation → orchestrator seeds it silently */
  pastFactOnFirstObservation: boolean;
}

export function detectMediumEvents(
  { currentEffective, state, isNewMovie, today }: DetectInput,
): DetectedEvent[] {
  if (!currentEffective || state.releasedEver) return [];
  if (currentEffective <= today) {
    // Same-run precedence: released suppresses announced and date_changed.
    return [{
      event: "released",
      effectiveDate: currentEffective,
      pastFactOnFirstObservation: isNewMovie && currentEffective < today,
    }];
  }
  if (!state.announcedEver) {
    return [{ event: "announced", effectiveDate: currentEffective, pastFactOnFirstObservation: false }];
  }
  if (state.lastLoggedDate !== null && state.lastLoggedDate !== currentEffective) {
    return [{ event: "date_changed", effectiveDate: currentEffective, pastFactOnFirstObservation: false }];
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fn` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions
git commit -m "feat: release-event detection with log-based dedupe semantics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: IMDb watchlist client (`imdb.ts`)

**Files:**
- Create: `supabase/functions/refresh/lib/imdb.ts`
- Test: `supabase/functions/refresh/lib/imdb_test.ts`

**Interfaces:**
- Consumes: `WatchlistItem` from `types.ts`.
- Produces: `parseImdbUserId(input: string): string | null`; `fetchWatchlist(userId: string, fetchFn?: typeof fetch): Promise<WatchlistItem[]>`; `class WatchlistPrivateError extends Error`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/refresh/lib/imdb_test.ts`:

```ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fetchWatchlist, parseImdbUserId, WatchlistPrivateError } from "./imdb.ts";

Deno.test("parseImdbUserId accepts profile URL, watchlist URL, and bare id", () => {
  assertEquals(parseImdbUserId("https://www.imdb.com/user/ur27331503/watchlist/"), "ur27331503");
  assertEquals(parseImdbUserId("https://www.imdb.com/user/ur27331503/"), "ur27331503");
  assertEquals(parseImdbUserId("ur27331503"), "ur27331503");
});

Deno.test("parseImdbUserId rejects opaque slugs and junk", () => {
  assertEquals(parseImdbUserId("https://www.imdb.com/user/p.abc123xyz/"), null);
  assertEquals(parseImdbUserId("https://www.imdb.com/list/ls050920959/"), null);
  assertEquals(parseImdbUserId("urban"), null);
});

function page(edges: unknown[], hasNext: boolean, endCursor: string | null) {
  return {
    data: {
      predefinedList: {
        id: "ls1", items: { total: 3, edges, pageInfo: { hasNextPage: hasNext, endCursor } },
      },
    },
  };
}
const title = (id: string, type = "movie") => ({
  node: { listItem: { id, titleText: { text: `T ${id}` }, releaseYear: { year: 2020 }, titleType: { id: type } } },
});

Deno.test("fetchWatchlist paginates and keeps only movies", async () => {
  const pages = [
    page([title("tt1"), title("tt2", "tvSeries")], true, "CUR1"),
    page([title("tt3")], false, null),
  ];
  let call = 0;
  const fakeFetch = ((_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (call === 1) assertEquals(body.variables.after, "CUR1");
    return Promise.resolve(new Response(JSON.stringify(pages[call++])));
  }) as typeof fetch;

  const items = await fetchWatchlist("ur27331503", fakeFetch);
  assertEquals(items.map((i) => i.imdbId), ["tt1", "tt3"]);
  assertEquals(items[0], { imdbId: "tt1", title: "T tt1", year: 2020 });
});

Deno.test("fetchWatchlist surfaces private lists as WatchlistPrivateError", async () => {
  const fakeFetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ errors: [{ message: "FORBIDDEN", extensions: { code: "FORBIDDEN" } }] })),
    )) as typeof fetch;
  await assertRejects(() => fetchWatchlist("ur0", fakeFetch), WatchlistPrivateError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fn` — Expected: FAIL — `Module not found ... imdb.ts`.

- [ ] **Step 3: Implement `imdb.ts`**

```ts
// IMDb's UNOFFICIAL GraphQL API — personal, non-commercial use.
// Keep every IMDb-specific assumption inside this module (spec §3a).
import type { WatchlistItem } from "./types.ts";

const ENDPOINT = "https://api.graphql.imdb.com/";

const QUERY = `query WL($userId: ID!, $first: Int!, $after: ID) {
  predefinedList(classType: WATCH_LIST, userId: $userId) {
    id
    items(first: $first, after: $after) {
      total
      edges { node { listItem { ... on Title {
        id titleText { text } releaseYear { year } titleType { id }
      } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export class WatchlistPrivateError extends Error {}

export function parseImdbUserId(input: string): string | null {
  const m = input.match(/\bur\d+\b/);
  return m ? m[0] : null;
}

export async function fetchWatchlist(
  userId: string,
  fetchFn: typeof fetch = fetch,
): Promise<WatchlistItem[]> {
  const items: WatchlistItem[] = [];
  let after: string | null = null;
  while (true) {
    const res = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { userId, first: 250, after } }),
    });
    if (!res.ok) throw new Error(`IMDb GraphQL HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors && JSON.stringify(json.errors).includes("FORBIDDEN")) {
      throw new WatchlistPrivateError("watchlist is private — set it to public on IMDb");
    }
    const conn = json.data?.predefinedList?.items;
    if (!conn) throw new Error("unexpected IMDb GraphQL response shape");
    for (const edge of conn.edges ?? []) {
      const t = edge?.node?.listItem;
      if (!t?.id || t.titleType?.id !== "movie") continue;
      items.push({ imdbId: t.id, title: t.titleText?.text ?? t.id, year: t.releaseYear?.year ?? null });
    }
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fn` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions
git commit -m "feat: IMDb watchlist client (unofficial GraphQL, isolated module)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: TMDb client (`tmdb.ts`)

**Files:**
- Create: `supabase/functions/refresh/lib/tmdb.ts`
- Test: `supabase/functions/refresh/lib/tmdb_test.ts`

**Interfaces:**
- Consumes: `DiscoverItem`, `MovieBundle`, `ProviderRow`, `RawDate` from `types.ts`.
- Produces: `findTmdbId(imdbId: string, token: string, fetchFn?): Promise<number | null>`; `fetchMovieBundle(tmdbId: number, token: string, fetchFn?): Promise<MovieBundle | null>`; `fetchDiscover(config: DiscoverConfig, token: string, fetchFn?): Promise<DiscoverItem[]>`; pure helpers `extractRawDates(releaseDates: unknown, regions?: string[]): RawDate[]` and `extractProviders(watchProviders: unknown, regions?: string[]): ProviderRow[]`; `type DiscoverConfig = { filters?: Record<string, string | number>; limit?: number }`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/refresh/lib/tmdb_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { extractProviders, extractRawDates, fetchDiscover, findTmdbId } from "./tmdb.ts";

Deno.test("extractRawDates keeps BG/US/GB, maps type 3/4, earliest wins, ignores others", () => {
  const payload = {
    results: [
      {
        iso_3166_1: "US",
        release_dates: [
          { type: 3, release_date: "2026-05-10T00:00:00.000Z" },
          { type: 3, release_date: "2026-05-01T00:00:00.000Z" }, // earlier wins
          { type: 4, release_date: "2026-08-01T00:00:00.000Z" },
          { type: 1, release_date: "2026-01-01T00:00:00.000Z" }, // premiere ignored
        ],
      },
      { iso_3166_1: "FR", release_dates: [{ type: 4, release_date: "2026-06-01T00:00:00.000Z" }] },
      { iso_3166_1: "BG", release_dates: [{ type: 5, release_date: "2026-09-01T00:00:00.000Z" }] },
    ],
  };
  assertEquals(extractRawDates(payload), [
    { region: "US", medium: "theatrical", date: "2026-05-01" },
    { region: "US", medium: "digital", date: "2026-08-01" },
  ]);
});

Deno.test("extractProviders flattens offer types for tracked regions with the region link", () => {
  const payload = {
    results: {
      BG: {
        link: "https://www.themoviedb.org/movie/1/watch?locale=BG",
        flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/n.png", display_priority: 1 }],
        rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.png", display_priority: 3 }],
      },
      DE: { link: "x", flatrate: [{ provider_id: 9, provider_name: "Nope" }] },
    },
  };
  assertEquals(extractProviders(payload), [
    {
      region: "BG", providerId: 8, offerType: "flatrate", providerName: "Netflix",
      logoPath: "/n.png", displayPriority: 1, link: "https://www.themoviedb.org/movie/1/watch?locale=BG",
    },
    {
      region: "BG", providerId: 2, offerType: "rent", providerName: "Apple TV",
      logoPath: "/a.png", displayPriority: 3, link: "https://www.themoviedb.org/movie/1/watch?locale=BG",
    },
  ]);
});

Deno.test("findTmdbId reads movie_results only", async () => {
  const fakeFetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ movie_results: [{ id: 550 }], tv_results: [{ id: 1 }] })))
  ) as typeof fetch;
  assertEquals(await findTmdbId("tt0137523", "tok", fakeFetch), 550);
});

Deno.test("fetchDiscover whitelists filters, paginates, trims to limit", async () => {
  const urls: string[] = [];
  const fakeFetch = ((url: unknown) => {
    urls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get("page"));
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: page * 100 + i, title: `M${page}-${i}`, release_date: "2026-01-01", poster_path: null,
    }));
    return Promise.resolve(new Response(JSON.stringify({ page, total_pages: 5, results })));
  }) as typeof fetch;

  const items = await fetchDiscover(
    { filters: { "sort_by": "popularity.desc", "vote_count.gte": 100, "evil_param": "x" }, limit: 30 },
    "tok",
    fakeFetch,
  );
  assertEquals(items.length, 30);
  assertEquals(urls.length, 2); // ceil(30/20) pages
  const u = new URL(urls[0]);
  assertEquals(u.searchParams.get("sort_by"), "popularity.desc");
  assertEquals(u.searchParams.get("vote_count.gte"), "100");
  assertEquals(u.searchParams.get("evil_param"), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fn` — Expected: FAIL — `Module not found ... tmdb.ts`.

- [ ] **Step 3: Implement `tmdb.ts`**

```ts
import type { DiscoverItem, MovieBundle, ProviderRow, RawDate } from "./types.ts";

const BASE = "https://api.themoviedb.org/3";
const REGIONS = ["BG", "US", "GB"];
const OFFER_TYPES = ["flatrate", "free", "ads", "rent", "buy"] as const;

export type DiscoverConfig = { filters?: Record<string, string | number>; limit?: number };

const ALLOWED_FILTERS = [
  "sort_by", "vote_count.gte", "vote_average.gte", "with_genres", "without_genres",
  "primary_release_date.gte", "primary_release_date.lte", "with_original_language",
  "region", "with_release_type",
];

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, token: string, fetchFn: typeof fetch): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDb HTTP ${res.status} for ${path}`);
    return res.json();
  }
}

export async function findTmdbId(
  imdbId: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  const json = await tmdbGet(`/find/${imdbId}?external_source=imdb_id`, token, fetchFn);
  return json?.movie_results?.[0]?.id ?? null;
}

// deno-lint-ignore no-explicit-any
export function extractRawDates(releaseDates: any, regions: string[] = REGIONS): RawDate[] {
  const out: RawDate[] = [];
  for (const entry of releaseDates?.results ?? []) {
    if (!regions.includes(entry?.iso_3166_1)) continue;
    for (const medium of ["theatrical", "digital"] as const) {
      const type = medium === "theatrical" ? 3 : 4;
      const dates = (entry.release_dates ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((d: any) => d?.type === type && d?.release_date)
        // deno-lint-ignore no-explicit-any
        .map((d: any) => String(d.release_date).slice(0, 10))
        .sort();
      if (dates.length) out.push({ region: entry.iso_3166_1, medium, date: dates[0] });
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export function extractProviders(watchProviders: any, regions: string[] = REGIONS): ProviderRow[] {
  const out: ProviderRow[] = [];
  for (const region of regions) {
    const entry = watchProviders?.results?.[region];
    if (!entry) continue;
    for (const offerType of OFFER_TYPES) {
      for (const p of entry[offerType] ?? []) {
        out.push({
          region,
          providerId: p.provider_id,
          offerType,
          providerName: p.provider_name,
          logoPath: p.logo_path ?? null,
          displayPriority: p.display_priority ?? null,
          link: entry.link ?? null,
        });
      }
    }
  }
  return out;
}

export async function fetchMovieBundle(
  tmdbId: number,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<MovieBundle | null> {
  const json = await tmdbGet(
    `/movie/${tmdbId}?append_to_response=release_dates,watch/providers,external_ids`,
    token,
    fetchFn,
  );
  if (!json) return null;
  return {
    title: json.title ?? null,
    year: json.release_date ? Number(String(json.release_date).slice(0, 4)) : null,
    posterPath: json.poster_path ?? null,
    imdbId: json.external_ids?.imdb_id || null,
    rawDates: extractRawDates(json.release_dates),
    providers: extractProviders(json["watch/providers"]),
  };
}

export async function fetchDiscover(
  config: DiscoverConfig,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoverItem[]> {
  const limit = config.limit ?? 50;
  const params = new URLSearchParams({ include_adult: "false", include_video: "false" });
  for (const [k, v] of Object.entries(config.filters ?? {})) {
    if (ALLOWED_FILTERS.includes(k)) params.set(k, String(v));
  }
  const items: DiscoverItem[] = [];
  const pages = Math.ceil(limit / 20);
  for (let page = 1; page <= pages; page++) {
    params.set("page", String(page));
    const json = await tmdbGet(`/discover/movie?${params}`, token, fetchFn);
    for (const r of json?.results ?? []) {
      items.push({
        tmdbId: r.id,
        title: r.title,
        year: r.release_date ? Number(String(r.release_date).slice(0, 4)) : null,
        posterPath: r.poster_path ?? null,
      });
    }
    if (!json || page >= (json.total_pages ?? 1)) break;
  }
  return items.slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fn` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions
git commit -m "feat: TMDb client (find, movie bundle, filtered discover)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Email digest (`email.ts`)

**Files:**
- Create: `supabase/functions/refresh/lib/email.ts`
- Test: `supabase/functions/refresh/lib/email_test.ts`

**Interfaces:**
- Consumes: `Medium` from `types.ts`, `EventKind` from `events.ts`.
- Produces: `buildDigest(events: DigestEvent[], appUrl: string): { subject: string; html: string } | null` (null when no events); `sendDigest(apiKey: string, from: string, to: string, digest: { subject: string; html: string }, fetchFn?): Promise<void>`; `interface DigestEvent { movieTitle: string; year: number | null; medium: Medium; event: EventKind; effectiveDate: string }`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/refresh/lib/email_test.ts`:

```ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildDigest, type DigestEvent } from "./email.ts";

const events: DigestEvent[] = [
  { movieTitle: "Dune 3", year: 2026, medium: "digital", event: "released", effectiveDate: "2026-07-15" },
  { movieTitle: "Akira", year: 2027, medium: "theatrical", event: "announced", effectiveDate: "2027-03-01" },
  { movieTitle: "Heat 2", year: 2026, medium: "digital", event: "date_changed", effectiveDate: "2026-11-05" },
];

Deno.test("empty events → null (zero-event runs send nothing)", () => {
  assertEquals(buildDigest([], "https://app.example"), null);
});

Deno.test("digest groups by kind and counts in the subject", () => {
  const digest = buildDigest(events, "https://app.example");
  assert(digest);
  assertEquals(digest.subject, "3 release updates");
  assertStringIncludes(digest.html, "Out now");
  assertStringIncludes(digest.html, "Dates announced");
  assertStringIncludes(digest.html, "Dates changed");
  assertStringIncludes(digest.html, "Dune 3");
  assertStringIncludes(digest.html, "digital");
  assertStringIncludes(digest.html, "2027-03-01");
  assertStringIncludes(digest.html, "https://app.example");
});

Deno.test("single event subject is singular", () => {
  const digest = buildDigest([events[0]], "https://app.example");
  assert(digest);
  assertEquals(digest.subject, "1 release update");
});

Deno.test("html escapes movie titles", () => {
  const digest = buildDigest(
    [{ movieTitle: "<script>x</script>", year: null, medium: "digital", event: "released", effectiveDate: "2026-01-01" }],
    "https://app.example",
  );
  assert(digest);
  assert(!digest.html.includes("<script>"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fn` — Expected: FAIL — `Module not found ... email.ts`.

- [ ] **Step 3: Implement `email.ts`**

```ts
import type { Medium } from "./types.ts";
import type { EventKind } from "./events.ts";

export interface DigestEvent {
  movieTitle: string;
  year: number | null;
  medium: Medium;
  event: EventKind;
  effectiveDate: string;
}

const GROUPS: { kind: EventKind; heading: string }[] = [
  { kind: "released", heading: "Out now" },
  { kind: "announced", heading: "Dates announced" },
  { kind: "date_changed", heading: "Dates changed" },
];

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function line(e: DigestEvent): string {
  const year = e.year ? ` (${e.year})` : "";
  return `<li><strong>${esc(e.movieTitle)}</strong>${year} — ${e.medium}, ${e.effectiveDate}</li>`;
}

export function buildDigest(
  events: DigestEvent[],
  appUrl: string,
): { subject: string; html: string } | null {
  if (events.length === 0) return null;
  const subject = `${events.length} release update${events.length === 1 ? "" : "s"}`;
  const sections = GROUPS
    .map(({ kind, heading }) => {
      const group = events.filter((e) => e.event === kind);
      if (!group.length) return "";
      return `<h3>${heading}</h3><ul>${group.map(line).join("")}</ul>`;
    })
    .join("");
  const html =
    `<div style="font-family:sans-serif;max-width:36rem">${sections}` +
    `<p><a href="${appUrl}">Open the dashboard</a></p></div>`;
  return { subject, html };
}

export async function sendDigest(
  apiKey: string,
  from: string,
  to: string,
  digest: { subject: string; html: string },
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: digest.subject, html: digest.html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fn` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions
git commit -m "feat: per-run email digest builder and Resend sender

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Web push sender (`push.ts`) + auth-role helper (`auth.ts`)

**Files:**
- Create: `supabase/functions/refresh/lib/push.ts`
- Create: `supabase/functions/refresh/lib/auth.ts`
- Test: `supabase/functions/refresh/lib/push_test.ts`, `supabase/functions/refresh/lib/auth_test.ts`

**Interfaces:**
- Produces (`push.ts`): `sendPushes(vapidKeysJson: string, contact: string, subs: SubRow[], messages: PushMessage[]): Promise<{ sent: number; staleEndpoints: string[] }>`; `isStaleStatus(status: number | undefined): boolean`; `interface PushMessage { title: string; body: string; url: string }`; `interface SubRow { endpoint: string; p256dh: string; auth: string }`.
- Produces (`auth.ts`): `roleFromAuthHeader(header: string | null): string | null` (decodes the JWT payload without verification — the platform already verified it; we only need the role claim to distinguish cron/service from the browser user).

- [ ] **Step 1: Write the failing tests**

`supabase/functions/refresh/lib/auth_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { roleFromAuthHeader } from "./auth.ts";

function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

Deno.test("extracts role from a bearer JWT", () => {
  assertEquals(roleFromAuthHeader(`Bearer ${jwt({ role: "service_role" })}`), "service_role");
  assertEquals(roleFromAuthHeader(`Bearer ${jwt({ role: "authenticated" })}`), "authenticated");
});

Deno.test("null on missing/malformed headers", () => {
  assertEquals(roleFromAuthHeader(null), null);
  assertEquals(roleFromAuthHeader("Bearer not.a"), null);
  assertEquals(roleFromAuthHeader("Bearer a.!!!.c"), null);
});
```

`supabase/functions/refresh/lib/push_test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { isStaleStatus } from "./push.ts";

Deno.test("404 and 410 mark a subscription stale; others don't", () => {
  assert(isStaleStatus(404));
  assert(isStaleStatus(410));
  assertEquals(isStaleStatus(201), false);
  assertEquals(isStaleStatus(500), false);
  assertEquals(isStaleStatus(undefined), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fn` — Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `auth.ts`**

```ts
export function roleFromAuthHeader(header: string | null): string | null {
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement `push.ts`**

```ts
import * as webpush from "jsr:@negrel/webpush@0.5.0";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** RFC 8030: 404/410 mean the subscription is gone — prune it. */
export function isStaleStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

export async function sendPushes(
  vapidKeysJson: string,
  contact: string,
  subs: SubRow[],
  messages: PushMessage[],
): Promise<{ sent: number; staleEndpoints: string[] }> {
  if (subs.length === 0 || messages.length === 0) return { sent: 0, staleEndpoints: [] };
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidKeysJson), { extractable: false });
  const appServer = await webpush.ApplicationServer.new({ contactInformation: contact, vapidKeys });
  const stale = new Set<string>();
  let sent = 0;
  for (const sub of subs) {
    const subscriber = appServer.subscribe({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    });
    for (const msg of messages) {
      if (stale.has(sub.endpoint)) break;
      try {
        await subscriber.pushTextMessage(JSON.stringify(msg), {});
        sent++;
      } catch (err) {
        const status = err instanceof webpush.PushMessageError
          ? err.response?.status
          : undefined;
        if (isStaleStatus(status)) stale.add(sub.endpoint);
        else console.error(`push to ${sub.endpoint} failed:`, err);
      }
    }
  }
  return { sent, staleEndpoints: [...stale] };
}
```

Note for the implementer: if `err.response` is not the actual property name on `PushMessageError` in `@negrel/webpush@0.5.0`, check the library (`npx deno doc jsr:@negrel/webpush@0.5.0` or its JSR page) — v0.5.0 exposes the failed `Response`; adapt the property access (e.g. `err.response.status` vs a method) but keep `isStaleStatus` as the single stale rule.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:fn` — Expected: all PASS (first run downloads `@negrel/webpush` from JSR).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions
git commit -m "feat: web-push sender with stale-subscription pruning and JWT role helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Database access layer (`db.ts`)

**Files:**
- Create: `supabase/functions/refresh/lib/db.ts`

No unit tests — this module is thin I/O over supabase-js, exercised end-to-end in Task 11. Keep every function a single query (plus the documented merge).

**Interfaces:**
- Consumes: `ProviderRow`, `RawDate` from `types.ts`.
- Produces (all take the `SupabaseClient` as first arg):
  - `createServiceClient(url: string, serviceKey: string): SupabaseClient`
  - `getSettings(db): Promise<Settings>` — `{ region_order: string[]; notify_email: string | null; notifications_paused: boolean; notify_hour: number }`
  - `getLists(db): Promise<ListRow[]>` — `{ id: number; kind: "imdb_watchlist" | "tmdb_discover"; name: string; sync_enabled: boolean; notifications_enabled: boolean; config: Record<string, unknown> }`
  - `openRun(db, trigger: "cron" | "manual"): Promise<number>` / `closeRun(db, id: number, patch: Record<string, unknown>): Promise<void>`
  - `getAllMovies(db): Promise<MovieRow[]>` — `{ id: number; imdb_id: string | null; tmdb_id: number | null; title: string | null; year: number | null; poster_path: string | null }`
  - `insertMovie(db, fields: Partial<MovieRow>): Promise<MovieRow>`
  - `updateMovie(db, id: number, patch: Record<string, unknown>): Promise<void>`
  - `mergeMovies(db, stubId: number, canonicalId: number): Promise<void>` — repoint stub memberships to canonical (skip lists where canonical already has one), then delete the stub row. Only ever called with an imdb-only stub (no dates/log rows by construction).
  - `getMemberships(db, listId: number): Promise<{ movie_id: number; on_list: boolean }[]>`
  - `upsertMembership(db, listId: number, movieId: number, onList: boolean): Promise<void>` — on conflict update `on_list` (+ `added_at`/`removed_at` transitions)
  - `replaceReleaseDates(db, movieId: number, rows: RawDate[]): Promise<void>` / `replaceProviders(db, movieId: number, rows: ProviderRow[]): Promise<void>` — delete-then-insert
  - `getLogStates(db): Promise<Map<string, MediumLogState>>` — key `` `${movie_id}:${medium}` ``, built from all `notification_log` rows ordered by `created_at`
  - `insertLogRows(db, rows: { movie_id: number; medium: string; event: string; effective_date: string; sent_at: string | null }[]): Promise<number[]>` — returns inserted ids
  - `markSent(db, ids: number[]): Promise<void>` — set `sent_at = now()`
  - `getSubscriptions(db): Promise<{ endpoint: string; p256dh: string; auth: string }[]>` / `deleteSubscriptions(db, endpoints: string[]): Promise<void>`

- [ ] **Step 1: Implement `db.ts`**

```ts
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ProviderRow, RawDate } from "./types.ts";
import type { MediumLogState } from "./events.ts";

export interface Settings {
  region_order: string[];
  notify_email: string | null;
  notifications_paused: boolean;
  notify_hour: number;
}

export interface ListRow {
  id: number;
  kind: "imdb_watchlist" | "tmdb_discover";
  name: string;
  sync_enabled: boolean;
  notifications_enabled: boolean;
  config: Record<string, unknown>;
}

export interface MovieRow {
  id: number;
  imdb_id: string | null;
  tmdb_id: number | null;
  title: string | null;
  year: number | null;
  poster_path: string | null;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`db ${what}: ${res.error.message}`);
  return res.data as T;
}

export function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function getSettings(db: SupabaseClient): Promise<Settings> {
  return unwrap(await db.from("settings").select("*").single(), "getSettings");
}

export async function getLists(db: SupabaseClient): Promise<ListRow[]> {
  return unwrap(await db.from("lists").select("*").order("position"), "getLists");
}

export async function openRun(db: SupabaseClient, trigger: "cron" | "manual"): Promise<number> {
  const row = unwrap(
    await db.from("refresh_runs").insert({ trigger }).select("id").single(),
    "openRun",
  );
  return row.id;
}

export async function closeRun(
  db: SupabaseClient,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  unwrap(
    await db.from("refresh_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id),
    "closeRun",
  );
}

export async function getAllMovies(db: SupabaseClient): Promise<MovieRow[]> {
  return unwrap(
    await db.from("movies").select("id, imdb_id, tmdb_id, title, year, poster_path"),
    "getAllMovies",
  );
}

export async function insertMovie(db: SupabaseClient, fields: Partial<MovieRow>): Promise<MovieRow> {
  return unwrap(
    await db.from("movies").insert(fields).select("id, imdb_id, tmdb_id, title, year, poster_path").single(),
    "insertMovie",
  );
}

export async function updateMovie(
  db: SupabaseClient,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  unwrap(await db.from("movies").update(patch).eq("id", id), "updateMovie");
}

export async function mergeMovies(db: SupabaseClient, stubId: number, canonicalId: number): Promise<void> {
  const stubMemberships = unwrap(
    await db.from("list_memberships").select("list_id, on_list").eq("movie_id", stubId),
    "mergeMovies.read",
  );
  const canonMemberships = unwrap(
    await db.from("list_memberships").select("list_id").eq("movie_id", canonicalId),
    "mergeMovies.readCanon",
  );
  const canonLists = new Set(canonMemberships.map((m: { list_id: number }) => m.list_id));
  for (const m of stubMemberships) {
    if (!canonLists.has(m.list_id)) {
      unwrap(
        await db.from("list_memberships").update({ movie_id: canonicalId })
          .eq("movie_id", stubId).eq("list_id", m.list_id),
        "mergeMovies.repoint",
      );
    }
  }
  unwrap(await db.from("list_memberships").delete().eq("movie_id", stubId), "mergeMovies.cleanup");
  unwrap(await db.from("movies").delete().eq("id", stubId), "mergeMovies.deleteStub");
}

export async function getMemberships(
  db: SupabaseClient,
  listId: number,
): Promise<{ movie_id: number; on_list: boolean }[]> {
  return unwrap(
    await db.from("list_memberships").select("movie_id, on_list").eq("list_id", listId),
    "getMemberships",
  );
}

export async function upsertMembership(
  db: SupabaseClient,
  listId: number,
  movieId: number,
  onList: boolean,
): Promise<void> {
  unwrap(
    await db.from("list_memberships").upsert({
      list_id: listId,
      movie_id: movieId,
      on_list: onList,
      removed_at: onList ? null : new Date().toISOString(),
    }, { onConflict: "list_id,movie_id" }),
    "upsertMembership",
  );
}

export async function replaceReleaseDates(
  db: SupabaseClient,
  movieId: number,
  rows: RawDate[],
): Promise<void> {
  unwrap(await db.from("release_dates").delete().eq("movie_id", movieId), "replaceReleaseDates.delete");
  if (rows.length) {
    unwrap(
      await db.from("release_dates").insert(
        rows.map((r) => ({ movie_id: movieId, region: r.region, medium: r.medium, release_date: r.date })),
      ),
      "replaceReleaseDates.insert",
    );
  }
}

export async function replaceProviders(
  db: SupabaseClient,
  movieId: number,
  rows: ProviderRow[],
): Promise<void> {
  unwrap(await db.from("watch_providers").delete().eq("movie_id", movieId), "replaceProviders.delete");
  if (rows.length) {
    unwrap(
      await db.from("watch_providers").insert(
        rows.map((r) => ({
          movie_id: movieId,
          region: r.region,
          provider_id: r.providerId,
          offer_type: r.offerType,
          provider_name: r.providerName,
          logo_path: r.logoPath,
          display_priority: r.displayPriority,
          link: r.link,
        })),
      ),
      "replaceProviders.insert",
    );
  }
}

export async function getLogStates(db: SupabaseClient): Promise<Map<string, MediumLogState>> {
  const rows = unwrap(
    await db.from("notification_log")
      .select("movie_id, medium, event, effective_date, created_at")
      .order("created_at", { ascending: true }),
    "getLogStates",
  );
  const map = new Map<string, MediumLogState>();
  for (const r of rows) {
    const key = `${r.movie_id}:${r.medium}`;
    const state = map.get(key) ?? { announcedEver: false, releasedEver: false, lastLoggedDate: null };
    if (r.event === "announced") state.announcedEver = true;
    if (r.event === "released") state.releasedEver = true;
    state.lastLoggedDate = r.effective_date;
    map.set(key, state);
  }
  return map;
}

export async function insertLogRows(
  db: SupabaseClient,
  rows: { movie_id: number; medium: string; event: string; effective_date: string; sent_at: string | null }[],
): Promise<number[]> {
  if (!rows.length) return [];
  const inserted = unwrap(
    await db.from("notification_log").insert(rows).select("id"),
    "insertLogRows",
  );
  return inserted.map((r: { id: number }) => r.id);
}

export async function markSent(db: SupabaseClient, ids: number[]): Promise<void> {
  if (!ids.length) return;
  unwrap(
    await db.from("notification_log").update({ sent_at: new Date().toISOString() }).in("id", ids),
    "markSent",
  );
}

export async function getSubscriptions(
  db: SupabaseClient,
): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
  return unwrap(await db.from("push_subscriptions").select("endpoint, p256dh, auth"), "getSubscriptions");
}

export async function deleteSubscriptions(db: SupabaseClient, endpoints: string[]): Promise<void> {
  if (!endpoints.length) return;
  unwrap(await db.from("push_subscriptions").delete().in("endpoint", endpoints), "deleteSubscriptions");
}
```

- [ ] **Step 2: Type-check**

Run: `npx deno check supabase/functions/refresh/lib/db.ts`
Expected: no errors (downloads `@supabase/supabase-js` on first run).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions
git commit -m "feat: service-role database access layer for the refresh pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Orchestrator (`index.ts`) + env scaffolding + VAPID script

**Files:**
- Create: `supabase/functions/refresh/index.ts`
- Create: `supabase/functions/.env.example`
- Create: `scripts/generate-vapid.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–9 (exact signatures in their Interfaces blocks).
- Produces: `POST /functions/v1/refresh` returning `{ skipped: true, reason: "gate" }` or `{ runId, moviesTotal, moviesMatched, eventsCreated, notificationsSent }`.

- [ ] **Step 1: Write `.env.example`**

```
# Local secrets for `npm run fn:serve` — copy to supabase/functions/.env (gitignored)
TMDB_BEARER=
# Optional: without it, email delivery is skipped (events still logged + marked sent)
RESEND_API_KEY=
NOTIFY_FROM=onboarding@resend.dev
# Optional: without it, push delivery is skipped
VAPID_KEYS_JSON=
PUSH_CONTACT=mailto:vasil.yoshev@gmail.com
# Where digest/push links point (the SPA)
APP_URL=http://localhost:5173
```

- [ ] **Step 2: Write `scripts/generate-vapid.ts`**

```ts
// One-time VAPID key generation (spec §8). Run:
//   npx deno run --allow-net scripts/generate-vapid.ts
// Put the printed JSON in VAPID_KEYS_JSON (single line).
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const keys = await webpush.generateVapidKeys({ extractable: true });
const exported = await webpush.exportVapidKeys(keys);
console.log(JSON.stringify(exported));
```

- [ ] **Step 3: Implement `index.ts`**

```ts
import { closeRun, createServiceClient, deleteSubscriptions, getAllMovies, getLists, getLogStates, getMemberships, getSettings, getSubscriptions, insertLogRows, insertMovie, markSent, mergeMovies, openRun, replaceProviders, replaceReleaseDates, updateMovie, upsertMembership, type MovieRow } from "./lib/db.ts";
import { fetchWatchlist } from "./lib/imdb.ts";
import { fetchDiscover, fetchMovieBundle, findTmdbId, type DiscoverConfig } from "./lib/tmdb.ts";
import { computeEffective, sofiaHour, sofiaToday } from "./lib/dates.ts";
import { detectMediumEvents } from "./lib/events.ts";
import { buildDigest, sendDigest, type DigestEvent } from "./lib/email.ts";
import { sendPushes, type PushMessage } from "./lib/push.ts";
import { roleFromAuthHeader } from "./lib/auth.ts";
import type { Medium } from "./lib/types.ts";

const MEDIUMS: Medium[] = ["theatrical", "digital"];

Deno.serve(async (req: Request) => {
  const role = roleFromAuthHeader(req.headers.get("authorization"));
  const trigger: "cron" | "manual" = role === "service_role" ? "cron" : "manual";

  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const settings = await getSettings(db);

  // Gate Hour: hourly cron only proceeds at the configured Sofia hour.
  if (trigger === "cron" && sofiaHour() !== settings.notify_hour) {
    return Response.json({ skipped: true, reason: "gate" });
  }

  const runId = await openRun(db, trigger);
  try {
    const tmdbToken = Deno.env.get("TMDB_BEARER");
    if (!tmdbToken) throw new Error("TMDB_BEARER is not set");
    const today = sofiaToday();

    // ---- 1. Load state
    const lists = await getLists(db);
    const movies = await getAllMovies(db);
    const byImdb = new Map(movies.filter((m) => m.imdb_id).map((m) => [m.imdb_id!, m]));
    const byTmdb = new Map(movies.filter((m) => m.tmdb_id).map((m) => [m.tmdb_id!, m]));
    const newMovieIds = new Set<number>();

    // ---- 2. Sync each sync-enabled list (soft membership, never delete)
    const activeIds = new Set<number>();
    for (const list of lists) {
      if (!list.sync_enabled) {
        for (const m of await getMemberships(db, list.id)) if (m.on_list) activeIds.add(m.movie_id);
        continue;
      }
      let listMovieIds: number[] = [];
      if (list.kind === "imdb_watchlist") {
        const userId = String(list.config.imdb_user_id ?? "");
        if (!userId) throw new Error(`list ${list.id} (${list.name}) has no imdb_user_id`);
        const items = await fetchWatchlist(userId);
        for (const item of items) {
          let movie = byImdb.get(item.imdbId);
          if (!movie) {
            movie = await insertMovie(db, { imdb_id: item.imdbId, title: item.title, year: item.year });
            byImdb.set(item.imdbId, movie);
            newMovieIds.add(movie.id);
          }
          listMovieIds.push(movie.id);
        }
      } else {
        const items = await fetchDiscover(list.config as DiscoverConfig, tmdbToken);
        for (const item of items) {
          let movie = byTmdb.get(item.tmdbId);
          if (!movie) {
            movie = await insertMovie(db, {
              tmdb_id: item.tmdbId, title: item.title, year: item.year, poster_path: item.posterPath,
            });
            byTmdb.set(item.tmdbId, movie);
            newMovieIds.add(movie.id);
          }
          listMovieIds.push(movie.id);
        }
      }
      const wanted = new Set(listMovieIds);
      const existing = await getMemberships(db, list.id);
      const existingIds = new Set(existing.map((m) => m.movie_id));
      for (const movieId of wanted) {
        const prev = existing.find((m) => m.movie_id === movieId);
        if (!prev || !prev.on_list) await upsertMembership(db, list.id, movieId, true);
      }
      for (const prev of existing) {
        if (prev.on_list && !wanted.has(prev.movie_id)) await upsertMembership(db, list.id, prev.movie_id, false);
      }
      for (const id of wanted) activeIds.add(id);
      void existingIds;
    }

    // ---- 3. Resolve identities: match imdb-only actives, merge collisions
    for (const movie of [...byImdb.values()]) {
      if (movie.tmdb_id || !activeIds.has(movie.id)) continue;
      const tmdbId = await findTmdbId(movie.imdb_id!, tmdbToken);
      if (!tmdbId) continue; // stays Unmatched, retried next run
      const existing = byTmdb.get(tmdbId);
      if (existing && existing.id !== movie.id) {
        await mergeMovies(db, movie.id, existing.id);
        await updateMovie(db, existing.id, { imdb_id: movie.imdb_id });
        existing.imdb_id = movie.imdb_id;
        byImdb.set(movie.imdb_id!, existing);
        activeIds.delete(movie.id);
        activeIds.add(existing.id);
        newMovieIds.delete(movie.id);
      } else {
        await updateMovie(db, movie.id, { tmdb_id: tmdbId });
        movie.tmdb_id = tmdbId;
        byTmdb.set(tmdbId, movie);
      }
    }

    // ---- 4. Refresh active matched movies + compute effective dates + detect events
    const logStates = await getLogStates(db);
    const paused = settings.notifications_paused;
    const notifyEligible = new Set<number>();
    for (const list of lists) {
      if (!list.notifications_enabled) continue;
      for (const m of await getMemberships(db, list.id)) if (m.on_list) notifyEligible.add(m.movie_id);
    }

    const allMoviesNow = await getAllMovies(db);
    const active = allMoviesNow.filter((m) => activeIds.has(m.id) && m.tmdb_id);
    let matched = 0;
    const pendingLog: {
      movie: MovieRow; medium: Medium; event: string; effective_date: string; silent: boolean;
    }[] = [];

    for (const movie of active) {
      const bundle = await fetchMovieBundle(movie.tmdb_id!, tmdbToken);
      if (!bundle) continue;
      matched++;
      const patch: Record<string, unknown> = {
        title: bundle.title ?? movie.title,
        year: bundle.year ?? movie.year,
        poster_path: bundle.posterPath ?? movie.poster_path,
      };
      if (bundle.imdbId && !movie.imdb_id && !byImdb.has(bundle.imdbId)) {
        patch.imdb_id = bundle.imdbId;
      }
      await replaceReleaseDates(db, movie.id, bundle.rawDates);
      await replaceProviders(db, movie.id, bundle.providers);

      for (const medium of MEDIUMS) {
        const eff = computeEffective(bundle.rawDates, settings.region_order, medium);
        patch[`${medium}_date`] = eff?.date ?? null;
        patch[`${medium}_region`] = eff?.region ?? null;
        const state = logStates.get(`${movie.id}:${medium}`) ??
          { announcedEver: false, releasedEver: false, lastLoggedDate: null };
        const detected = detectMediumEvents({
          currentEffective: eff?.date ?? null,
          state,
          isNewMovie: newMovieIds.has(movie.id),
          today,
        });
        for (const ev of detected) {
          const silent = ev.pastFactOnFirstObservation || paused || !notifyEligible.has(movie.id);
          pendingLog.push({ movie, medium, event: ev.event, effective_date: ev.effectiveDate, silent });
        }
      }
      await updateMovie(db, movie.id, patch);
    }

    // ---- 5. Log all events; deliver the non-silent ones
    const rows = pendingLog.map((p) => ({
      movie_id: p.movie.id, medium: p.medium, event: p.event,
      effective_date: p.effective_date, sent_at: null,
    }));
    const ids = await insertLogRows(db, rows);
    const toSend = pendingLog
      .map((p, i) => ({ ...p, logId: ids[i] }))
      .filter((p) => !p.silent);

    let notificationsSent = 0;
    if (toSend.length) {
      const appUrl = Deno.env.get("APP_URL") ?? "/";
      const digestEvents: DigestEvent[] = toSend.map((p) => ({
        movieTitle: p.movie.title ?? p.movie.imdb_id ?? String(p.movie.id),
        year: p.movie.year,
        medium: p.medium,
        event: p.event as DigestEvent["event"],
        effectiveDate: p.effective_date,
      }));

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey && settings.notify_email) {
        const digest = buildDigest(digestEvents, appUrl);
        if (digest) {
          await sendDigest(resendKey, Deno.env.get("NOTIFY_FROM") ?? "onboarding@resend.dev", settings.notify_email, digest);
        }
      } else {
        console.warn("RESEND_API_KEY or notify_email missing — skipping email digest");
      }

      const vapid = Deno.env.get("VAPID_KEYS_JSON");
      if (vapid) {
        const subs = await getSubscriptions(db);
        const messages: PushMessage[] = digestEvents.map((e) => ({
          title: e.event === "released"
            ? `${e.movieTitle} is out now (${e.medium})`
            : e.event === "announced"
            ? `${e.movieTitle}: ${e.medium} date announced`
            : `${e.movieTitle}: ${e.medium} date changed`,
          body: `${e.medium} — ${e.effectiveDate}`,
          url: appUrl,
        }));
        const result = await sendPushes(vapid, Deno.env.get("PUSH_CONTACT") ?? "mailto:vasil.yoshev@gmail.com", subs, messages);
        await deleteSubscriptions(db, result.staleEndpoints);
      } else {
        console.warn("VAPID_KEYS_JSON missing — skipping push");
      }

      await markSent(db, toSend.map((p) => p.logId));
      notificationsSent = toSend.length;
    }

    const summary = {
      runId,
      moviesTotal: activeIds.size,
      moviesMatched: matched,
      eventsCreated: pendingLog.length,
      notificationsSent,
    };
    await closeRun(db, runId, {
      status: "success",
      movies_total: summary.moviesTotal,
      movies_matched: summary.moviesMatched,
      events_created: summary.eventsCreated,
      notifications_sent: summary.notificationsSent,
    });
    return Response.json(summary);
  } catch (err) {
    await closeRun(db, runId, { status: "error", error: String(err) });
    console.error("refresh run failed:", err);
    return Response.json({ runId, error: String(err) }, { status: 500 });
  }
});
```

- [ ] **Step 4: Type-check everything**

Run: `npx deno check supabase/functions/refresh/index.ts`
Expected: no errors.

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:fn` — Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions scripts
git commit -m "feat: refresh orchestrator (gate, list sync, identity merge, events, delivery)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Local end-to-end run

**Files:**
- Create: `supabase/functions/.env` (from `.env.example`, gitignored — real `TMDB_BEARER` from the old app's `.env.local`)

**Interfaces:**
- Consumes: the deployed-locally `refresh` function; local stack from Task 2.

- [ ] **Step 1: Prepare env + reset DB**

```bash
cp supabase/functions/.env.example supabase/functions/.env
# put the real TMDB_BEARER value (from ../imdb-digital-release-notifier/.env.local) into supabase/functions/.env
npm run db:reset
```

- [ ] **Step 2: Serve and invoke**

Terminal A: `npm run fn:serve` (leave running).
Terminal B (get keys from `npx supabase status`):

```bash
SERVICE_KEY=$(npx supabase status -o json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).SERVICE_ROLE_KEY??JSON.parse(s).service_role_key??''))")
curl -s -X POST http://127.0.0.1:54321/functions/v1/refresh -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" | tee /tmp/run1.json
```

Expected: JSON like `{"runId":1,"moviesTotal":~260,"moviesMatched":~250+,"eventsCreated":>0,"notificationsSent":small}`. Notes:
- `moviesTotal` ≈ watchlist movies (~216, series excluded) + 50 popular − overlap.
- Cron would be gated by hour, but a `service_role` invocation at a non-gate hour is still `trigger=cron` → if the current Sofia hour ≠ 9 the run returns `{"skipped":true}`. **For this E2E, temporarily set the gate to the current hour**: `docker exec -i <db-container> psql -U postgres -d postgres -c "update settings set notify_hour = extract(hour from now() at time zone 'Europe/Sofia');"` — or invoke with the anon key + a signed-in user token later. Simplest: update `notify_hour` first, restore after.
- First run: released events for already-out movies are seeded silent; announced events for genuinely upcoming titles are delivered (email/push skipped-with-warning if keys unset) and marked sent.

- [ ] **Step 3: Assert DB state**

```bash
docker exec -i <db-container> psql -U postgres -d postgres -c "
select
  (select count(*) from movies) as movies,
  (select count(*) from list_memberships where on_list) as active_memberships,
  (select count(*) from release_dates) as raw_dates,
  (select count(*) from watch_providers) as providers,
  (select count(*) from notification_log) as log_rows,
  (select count(*) from notification_log where sent_at is null) as silent_rows,
  (select status from refresh_runs order by id desc limit 1) as last_status;"
```
Expected: movies > 200; active_memberships ≈ movies (± overlap); raw_dates > 0; log_rows > 0; silent_rows = most of log_rows; last_status = `success`.

- [ ] **Step 4: Idempotency — invoke again**

Re-run the curl. Expected: `eventsCreated: 0` (or only genuinely new `date_changed`), `notificationsSent: 0`. The log row count must not grow with duplicates of announced/released.

- [ ] **Step 5: Record results**

Paste both run summaries and the SQL output into the task notes / commit message body.

```bash
git add -A
git commit -m "test: verified local E2E refresh run (seeding, idempotency)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: pg_cron schedule migration

**Files:**
- Create: `supabase/migrations/20260715130000_cron.sql`

**Interfaces:**
- Consumes: Vault secrets `project_url` and `service_role_key` (seeded per environment).
- Produces: hourly cron job `refresh-hourly` invoking the function.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase migration up
docker exec -i <db-container> psql -U postgres -d postgres -c "select jobname, schedule, active from cron.job;"
```
Expected: one row `refresh-hourly | 0 * * * * | t`.
(If `vault.create_secret` hasn't been run locally the job body will error at fire time, not at schedule time — that's fine for local; seed the two secrets to test an actual fire.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations
git commit -m "feat: hourly pg_cron job invoking the refresh function via vault-stored credentials

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deferred (NOT in this plan)

- **Frontend SPA** — separate plan (`2026-07-15-frontend-spa.md`, written after this plan completes).
- **Self-hosted Supabase deployment** — separate effort per spec §13 (user-driven; Docker Compose, auth account + `GOTRUE_DISABLE_SIGNUP`, Vault seeding, secrets, Netlify env).
- **Resend account + yoshevbot.uk domain** — user task; the pipeline degrades gracefully (warns + skips email) until `RESEND_API_KEY` is set.
- **Real-device push E2E** — needs the SPA (subscription UI) + VAPID keys; unit + code paths are covered here.
