import { createServiceClient, getOwnerId } from "./lib/db.ts";
import { runFull, runTick } from "./lib/orchestrator.ts";
import { claimsFromAuthHeader } from "./lib/auth.ts";

// Thin HTTP handler: authenticate, pick the job, delegate to the orchestrator.
// The pipeline itself lives in lib/orchestrator.ts so it can be driven and
// tested without the edge runtime.
Deno.serve(async (req: Request) => {
  const claims = claimsFromAuthHeader(req.headers.get("authorization"));
  if (claims?.role !== "service_role" && claims?.role !== "authenticated") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const trigger: "cron" | "manual" = claims.role === "service_role" ? "cron" : "manual";

  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const ownerId = await getOwnerId(db);
  // The manual trigger is the owner's full-pipeline refresh (SPEC §8). Per-user
  // Refresh-now arrives with the delivery slice (#56).
  if (trigger === "manual" && claims.sub !== ownerId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { job?: string };
  // Cron drives both jobs by body discriminator; a manual owner trigger is
  // always a full run.
  const job: "full" | "tick" = trigger === "cron" && body.job === "tick" ? "tick" : "full";

  const tmdbToken = Deno.env.get("TMDB_BEARER");
  if (!tmdbToken) return Response.json({ error: "TMDB_BEARER is not set" }, { status: 500 });

  try {
    const summary = job === "tick"
      ? await runTick(db, trigger, tmdbToken, ownerId)
      : await runFull(db, trigger, tmdbToken, ownerId);
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
