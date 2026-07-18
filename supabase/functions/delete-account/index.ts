import { createServiceClient } from "../refresh/lib/db.ts";
import { claimsFromAuthHeader } from "../refresh/lib/auth.ts";

// SPEC §3 — self-serve account deletion. Removing the auth user cascades through
// every FK (profiles, settings, lists, memberships, push subs, deliveries);
// shared movie rows are never user-owned, so they stay.
Deno.serve(async (req: Request) => {
  const claims = claimsFromAuthHeader(req.headers.get("authorization"));
  if (claims?.role !== "authenticated" || !claims.sub) {
    return Response.json({ error: "sign in" }, { status: 401 });
  }
  const db = createServiceClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    const { error } = await db.auth.admin.deleteUser(claims.sub);
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("delete-account failed:", err);
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
});
