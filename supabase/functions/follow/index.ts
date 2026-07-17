import { checkRateLimit, createServiceClient } from "../refresh/lib/db.ts";
import { claimsFromAuthHeader } from "../refresh/lib/auth.ts";
import { runFollow } from "../refresh/lib/follow.ts";

// SPEC §11 — follow/unfollow. Authenticated only, per-user rate limited (an
// untracked follow spends 1–2 TMDB calls to hydrate, so it's gated).
const RATE_LIMIT = Number(Deno.env.get("FOLLOW_RATE_LIMIT") ?? "20");
const RATE_WINDOW_S = Number(Deno.env.get("FOLLOW_RATE_WINDOW_S") ?? "60");

Deno.serve(async (req: Request) => {
  const claims = claimsFromAuthHeader(req.headers.get("authorization"));
  if (claims?.role !== "authenticated" || !claims.sub) {
    return Response.json({ error: "sign in to follow" }, { status: 401 });
  }
  const tmdbToken = Deno.env.get("TMDB_BEARER");
  if (!tmdbToken) return Response.json({ error: "TMDB_BEARER is not set" }, { status: 500 });

  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({})) as { tmdbId?: number; action?: string };
  const tmdbId = Number(body.tmdbId);
  if (!Number.isFinite(tmdbId)) {
    return Response.json({ error: "tmdbId required" }, { status: 400 });
  }
  const action = body.action === "unfollow" ? "unfollow" : "follow";

  if (!(await checkRateLimit(db, claims.sub, "follow", RATE_LIMIT, RATE_WINDOW_S))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const result = await runFollow(db, claims.sub, tmdbId, action, tmdbToken);
    return Response.json(result);
  } catch (err) {
    console.error("follow failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
