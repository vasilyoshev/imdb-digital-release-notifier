/**
 * Cloudflare Worker for release-notifier (Netlify-exit cutover, repo #75).
 *
 * The site is a Vite SPA served from Cloudflare Workers Static Assets. This
 * Worker adds the server-side surfaces the SPA can't: the anonymous "Digital
 * Release Radar" Stremio addon (SPEC §12) and the personalized token'd addon
 * (map #109): /{token}/manifest.json + /{token}/catalog/movie/… built from the
 * user's server-side config via anon-key RPCs. Only the addon routes run
 * through here (forced via `run_worker_first` in wrangler.toml); everything
 * else — the app shell, hashed assets, and SPA client routes (including
 * /configure and /{token}/configure) — is handled by the static-assets binding
 * (`env.ASSETS`), which applies the single-page-application not-found fallback.
 */
import { buildManifest, fetchCatalog, parseExtras, windowForCatalog } from "./stremio-core";
import {
  buildListMetas,
  buildPersonalManifest,
  listIdOfSource,
  parseCatalogs,
  type ListRow,
  type TokenData,
} from "./personal";

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
// Stremio addons are heavily cached at the edge; the anon radar changes hourly
// at most, but token'd catalogs must pick up /configure edits within ~5 min.
// No stale-while-revalidate on the token'd routes: SWR let caches serve up to an
// hour-old config after the 5 min lapsed (observed in #114), and Stremio adds its
// own caching on top — so staleness here stays hard-bounded at max-age.
const CACHE_ANON = "public, max-age=3600, stale-while-revalidate=86400";
const CACHE_PERSONAL = "public, max-age=300";

function json(
  body: unknown,
  cache: string = CACHE_ANON,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...CORS, "cache-control": cache, ...extra },
  });
}

/** Call a PostgREST RPC with the anon key — the Worker's only credential; the
 * addon token in the arguments is what unlocks the user-scoped reads. */
async function rpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`RPC ${fn} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Split a catalog path tail ("{id}[/{extras}][.json]") into id + raw extras. */
function splitCatalogPath(tail: string): { catalogId: string; extraRaw: string | undefined } {
  const rest = tail.replace(/\.json$/, "");
  const slash = rest.indexOf("/");
  return {
    catalogId: slash === -1 ? rest : rest.slice(0, slash),
    extraRaw: slash === -1 ? undefined : rest.slice(slash + 1),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Anon manifest route (SPEC §12).
    if (path === "/manifest.json") return json(buildManifest());

    // Anon catalog route: /catalog/movie/{id}[.json] and /catalog/movie/{id}/{extras}[.json]
    if (path.startsWith("/catalog/movie/")) {
      const { catalogId, extraRaw } = splitCatalogPath(path.slice("/catalog/movie/".length));
      const window = windowForCatalog(catalogId);
      if (!window) return new Response("not found", { status: 404, headers: CORS });
      const { region, skip } = parseExtras(extraRaw);
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
        return json({ metas: [] }, CACHE_ANON, { "x-error": String(err) });
      }
    }

    // Personalized addon (map #109): /{token}/manifest.json and
    // /{token}/catalog/movie/…. Other token-prefixed paths (notably
    // /{token}/configure, Stremio's Configure target) fall through to the SPA.
    const tokenMatch = path.match(/^\/([0-9a-f]{48})(\/.*)$/);
    if (tokenMatch) {
      const [, token, sub] = tokenMatch;

      if (sub === "/manifest.json") {
        try {
          const data = await rpc<TokenData | null>(env, "stremio_config_by_token", {
            p_token: token,
          });
          return json(buildPersonalManifest(data), CACHE_PERSONAL);
        } catch (err) {
          // Transient backend failure must not look like a revoked token
          // (which serves an empty-catalog manifest) — fail loud instead.
          return new Response(String(err), { status: 502, headers: CORS });
        }
      }

      if (sub.startsWith("/catalog/movie/")) {
        const { catalogId, extraRaw } = splitCatalogPath(sub.slice("/catalog/movie/".length));
        const { region: extraRegion, skip } = parseExtras(extraRaw);
        try {
          const data = await rpc<TokenData | null>(env, "stremio_config_by_token", {
            p_token: token,
          });
          if (!data) return json({ metas: [] }, CACHE_PERSONAL);
          // Catalog ids are the user-defined entries' ids (#116).
          const def = parseCatalogs(data.config, data.lists).find((d) => d.id === catalogId);
          if (!def || !def.enabled) return json({ metas: [] }, CACHE_PERSONAL);

          const listId = listIdOfSource(def.source);
          if (listId != null) {
            const rows = await rpc<ListRow[]>(env, "stremio_list_movies", {
              p_token: token,
              p_list_id: listId,
            });
            return json({ metas: buildListMetas(rows, def, skip) }, CACHE_PERSONAL);
          }

          const window = windowForCatalog(def.source);
          if (!window) return json({ metas: [] }, CACHE_PERSONAL);
          // The in-Stremio region dropdown wins when used; otherwise the
          // configured region (parseExtras alone can't tell "US picked" from
          // "no genre given" — both come back as US).
          const hasGenre = extraRaw != null && /(^|&)genre=/.test(decodeURIComponent(extraRaw));
          const region = hasGenre ? extraRegion : def.region;
          const metas = await fetchCatalog(
            env.VITE_SUPABASE_URL,
            env.VITE_SUPABASE_ANON_KEY,
            window,
            region,
            skip,
          );
          return json({ metas }, CACHE_PERSONAL);
        } catch (err) {
          return json({ metas: [] }, CACHE_PERSONAL, { "x-error": String(err) });
        }
      }
    }

    // Everything else: static assets + SPA fallback.
    return env.ASSETS.fetch(request);
  },
};
