import { createServiceClient, getOwnerId } from "./lib/db.ts";
import { checkUserRefreshRate, runDelivery, runFull, runTick, runUserRefresh } from "./lib/orchestrator.ts";
import { claimsFromAuthHeader } from "./lib/auth.ts";

// Thin HTTP handler: authenticate, pick the job, delegate to the orchestrator.
// The pipeline itself lives in lib/orchestrator.ts so it can be driven and
// tested without the edge runtime.
//
// - cron (service role): body.job ∈ {full, tick, delivery}, default full.
// - manual (authenticated): the owner gets the full-pipeline trigger; any other
//   user gets their own scoped, rate-limited Refresh-now (SPEC §8).
Deno.serve(async (req: Request) => {
  const claims = claimsFromAuthHeader(req.headers.get("authorization"));
  if (claims?.role !== "service_role" && claims?.role !== "authenticated") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const ownerId = await getOwnerId(db);

  const tmdbToken = Deno.env.get("TMDB_BEARER");
  if (!tmdbToken) return Response.json({ error: "TMDB_BEARER is not set" }, { status: 500 });

  try {
    // Manual, non-owner → the caller's own scoped Refresh-now, rate-limited.
    if (claims.role === "authenticated" && claims.sub !== ownerId) {
      const retryAfter = await checkUserRefreshRate(db, claims.sub!);
      if (retryAfter > 0) {
        return Response.json({ error: "rate_limited", retryAfterSeconds: retryAfter }, { status: 429 });
      }
      return Response.json(await runUserRefresh(db, claims.sub!, tmdbToken, ownerId));
    }

    // Cron jobs by discriminator; a manual owner trigger is the full pipeline.
    const body = await req.json().catch(() => ({})) as { job?: string };
    const trigger: "cron" | "manual" = claims.role === "service_role" ? "cron" : "manual";
    const job = trigger === "cron" ? (body.job ?? "full") : "full";

    const summary = job === "tick"
      ? await runTick(db, trigger, tmdbToken, ownerId)
      : job === "delivery"
      ? await runDelivery(db, trigger, ownerId)
      : await runFull(db, trigger, tmdbToken, ownerId);
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
