import { createServiceClient } from "../refresh/lib/db.ts";
import { claimsFromAuthHeader } from "../refresh/lib/auth.ts";
import { runOnboard } from "../refresh/lib/onboard.ts";

// SPEC §3 — the onboarding wizard's write path. Authenticated caller completes
// their own onboarding (settings + optional watchlist list + onboarded flag).
Deno.serve(async (req: Request) => {
  const claims = claimsFromAuthHeader(req.headers.get("authorization"));
  if (claims?.role !== "authenticated" || !claims.sub) {
    return Response.json({ error: "sign in" }, { status: 401 });
  }
  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = await req.json().catch(() => ({})) as {
    regionCascade?: string[];
    timezone?: string;
    imdbUserId?: string | null;
  };
  try {
    const result = await runOnboard(db, claims.sub, {
      regionCascade: body.regionCascade ?? [],
      timezone: body.timezone ?? "",
      imdbUserId: body.imdbUserId ?? null,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
});
