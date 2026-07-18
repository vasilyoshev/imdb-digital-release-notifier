import { createServiceClient } from "../refresh/lib/db.ts";
import { claimsFromAuthHeader } from "../refresh/lib/auth.ts";
import { parseWatchlistInput, upsertWatchlistList } from "../refresh/lib/onboard.ts";

// SPEC §5a — connect/change an IMDb watchlist from anywhere in the app (not just
// settings). Parses the profile/watchlist URL or bare `ur…` id, then provisions
// the user's watchlist list (service role — clients can't insert a watchlist).
Deno.serve(async (req: Request) => {
  const claims = claimsFromAuthHeader(req.headers.get("authorization"));
  if (claims?.role !== "authenticated" || !claims.sub) {
    return Response.json({ error: "sign in" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { url?: string };
  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    const imdbUserId = parseWatchlistInput(body.url ?? "");
    await upsertWatchlistList(db, claims.sub, imdbUserId);
    return Response.json({ ok: true, imdbUserId });
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
});
