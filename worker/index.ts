/**
 * Cloudflare Worker for release-notifier (Netlify-exit cutover, repo #75).
 *
 * The site is a Vite SPA served from Cloudflare Workers Static Assets. This
 * Worker adds one server-side surface the SPA can't: the "Digital Release Radar"
 * Stremio addon (SPEC §12), ported from the retired Netlify function. Only the
 * addon routes run through here (forced via `run_worker_first` in wrangler.toml);
 * everything else — the app shell, hashed assets, and SPA client routes — is
 * handled by the static-assets binding (`env.ASSETS`), which applies the
 * single-page-application not-found fallback.
 */
import { buildManifest, fetchCatalog, parseExtras, windowForCatalog } from "./stremio-core";

interface Env {
  // Static-assets binding (Workers Static Assets). Typed structurally so the
  // Worker needs no @cloudflare/workers-types dependency to bundle.
  ASSETS: { fetch(request: Request): Promise<Response> };
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
// Stremio addons are heavily cached at the edge; the radar changes hourly at most.
const CACHE = "public, max-age=3600, stale-while-revalidate=86400";

function json(body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...CORS, "cache-control": CACHE, ...extra },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Manifest route (SPEC §12).
    if (path === "/manifest.json") return json(buildManifest());

    // Catalog route: /catalog/movie/{id}[.json] and /catalog/movie/{id}/{extras}[.json]
    if (path.startsWith("/catalog/movie/")) {
      const rest = path.slice("/catalog/movie/".length).replace(/\.json$/, "");
      const slash = rest.indexOf("/");
      const catalogId = slash === -1 ? rest : rest.slice(0, slash);
      const extra = slash === -1 ? undefined : rest.slice(slash + 1);
      const window = windowForCatalog(catalogId);
      if (!window) return new Response("not found", { status: 404, headers: CORS });
      const { region, skip } = parseExtras(extra);
      try {
        const metas = await fetchCatalog(
          env.VITE_SUPABASE_URL,
          env.VITE_SUPABASE_ANON_KEY,
          window,
          region,
          skip,
        );
        return json({ metas });
      } catch (err) {
        return json({ metas: [] }, { "x-error": String(err) });
      }
    }

    // Everything else: static assets + SPA fallback.
    return env.ASSETS.fetch(request);
  },
};
