import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSupportedRegions } from "./db.ts";
import { parseImdbUserId } from "./imdb.ts";

/** Create or update the user's single IMDb watchlist list (SPEC §5a). Clients
 * can't insert a watchlist list under §13 RLS, so this runs as service role. */
export async function upsertWatchlistList(
  db: SupabaseClient,
  userId: string,
  imdbUserId: string,
): Promise<void> {
  const { data: existing, error } = await db.from("lists")
    .select("id").eq("user_id", userId).eq("kind", "imdb_watchlist").limit(1);
  if (error) throw new Error(`lists read: ${error.message}`);
  const config = { imdb_user_id: imdbUserId };
  if (existing && existing.length) {
    await db.from("lists").update({ config, sync_enabled: true }).eq("id", existing[0].id);
  } else {
    await db.from("lists").insert({
      user_id: userId,
      kind: "imdb_watchlist",
      name: "Watchlist",
      position: 1,
      sync_enabled: true,
      notifications_enabled: true,
      config,
    });
  }
}

/** Parse + validate an IMDb profile/watchlist URL or bare `ur…` id. */
export function parseWatchlistInput(input: string): string {
  const parsed = parseImdbUserId(input.trim());
  if (!parsed) {
    throw new Error("that doesn't look like an IMDb watchlist — paste your profile URL or ur… id");
  }
  return parsed;
}

export interface OnboardInput {
  regionCascade: string[];
  timezone: string;
  /** A parsed `ur…` id, or null/absent to skip watchlist import. */
  imdbUserId?: string | null;
}

/**
 * SPEC §3 — complete the onboarding wizard for one user (service role): save the
 * region cascade + timezone, optionally provision their IMDb watchlist list
 * (clients can't insert a watchlist list under §13 RLS), and flip
 * `profiles.onboarded` so the wizard doesn't reappear.
 */
export async function runOnboard(
  db: SupabaseClient,
  userId: string,
  input: OnboardInput,
): Promise<{ ok: true; watchlist: boolean }> {
  const supported = new Set(await getSupportedRegions(db));
  const cascade = input.regionCascade.filter((r) => supported.has(r));
  if (!cascade.length) throw new Error("pick at least one supported region");
  if (!input.timezone) throw new Error("timezone is required");

  // Accept a bare `ur…` id or any IMDb profile/watchlist URL; reject slugs.
  const raw = input.imdbUserId?.trim() || null;
  const imdbUserId = raw ? parseImdbUserId(raw) : null;
  if (raw && !imdbUserId) {
    throw new Error("that doesn't look like an IMDb watchlist — paste your profile URL or ur… id");
  }

  const sErr = (await db.from("settings")
    .update({ region_cascade: cascade, timezone: input.timezone })
    .eq("user_id", userId)).error;
  if (sErr) throw new Error(`settings: ${sErr.message}`);

  if (imdbUserId) await upsertWatchlistList(db, userId, imdbUserId);

  const pErr = (await db.from("profiles").update({ onboarded: true }).eq("user_id", userId)).error;
  if (pErr) throw new Error(`profile: ${pErr.message}`);

  return { ok: true, watchlist: !!imdbUserId };
}
