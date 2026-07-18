import type { Config, Context } from "@netlify/functions";
import {
  buildManifest,
  fetchCatalog,
  parseExtras,
  windowForCatalog,
} from "./_shared/stremio-core.ts";

// The "Digital Release Radar" Stremio addon (SPEC §12): a hand-rolled,
// catalogs-only HTTP addon. `/manifest.json` + `/catalog/movie/{id}[/{extras}].json`,
// CORS `*`, durable CDN cache. Reads radar_entries + movies through the anon
// PostgREST surface — no service role, no TMDB, no browser secrets.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};
const CACHE = "public, durable, s-maxage=3600, stale-while-revalidate=86400";

function json(body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      ...CORS,
      "Netlify-CDN-Cache-Control": CACHE,
      ...extraHeaders,
    },
  });
}

export default async (_req: Request, context: Context) => {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") ?? Netlify.env.get("SUPABASE_URL");
  const anonKey = Netlify.env.get("VITE_SUPABASE_ANON_KEY") ?? Netlify.env.get("SUPABASE_ANON_KEY");

  const params = context.params as { catalog?: string; extra?: string };
  // Manifest route.
  if (!params.catalog) return json(buildManifest());

  if (!supabaseUrl || !anonKey) {
    return json({ metas: [] }, { "x-error": "supabase env not configured" });
  }

  const catalogId = params.catalog.replace(/\.json$/, "");
  const window = windowForCatalog(catalogId);
  if (!window) return new Response("not found", { status: 404, headers: CORS });

  const { region, skip } = parseExtras(params.extra?.replace(/\.json$/, ""));
  try {
    const metas = await fetchCatalog(supabaseUrl, anonKey, window, region, skip);
    return json({ metas });
  } catch (err) {
    console.error("catalog failed:", err);
    return json({ metas: [] }, { "x-error": String(err) });
  }
};

export const config: Config = {
  path: [
    "/manifest.json",
    "/catalog/movie/:catalog",
    "/catalog/movie/:catalog/:extra",
  ],
};
