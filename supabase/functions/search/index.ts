import { checkRateLimit, createServiceClient } from "../refresh/lib/db.ts";
import { claimsFromAuthHeader } from "../refresh/lib/auth.ts";
import { runSearch } from "../refresh/lib/search.ts";

// SPEC §11 — the search proxy. Authenticated only (anonymous is gated in the UI
// and here: zero anonymous TMDB spend), per-user rate limited, bearer stays
// server-side.
const RATE_LIMIT = Number(Deno.env.get("SEARCH_RATE_LIMIT") ?? "30");
const RATE_WINDOW_S = Number(Deno.env.get("SEARCH_RATE_WINDOW_S") ?? "60");

Deno.serve(async (req: Request) => {
  const claims = claimsFromAuthHeader(req.headers.get("authorization"));
  if (claims?.role !== "authenticated" || !claims.sub) {
    return Response.json({ error: "sign in to search" }, { status: 401 });
  }
  const tmdbToken = Deno.env.get("TMDB_BEARER");
  if (!tmdbToken) return Response.json({ error: "TMDB_BEARER is not set" }, { status: 500 });

  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await checkRateLimit(db, claims.sub, "search", RATE_LIMIT, RATE_WINDOW_S))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as { q?: string };
  try {
    const results = await runSearch(db, claims.sub, body.q ?? "", tmdbToken);
    return Response.json({ results });
  } catch (err) {
    console.error("search failed:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
