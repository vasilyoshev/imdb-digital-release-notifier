import { assertEquals } from "jsr:@std/assert@1";
import {
  extractGenres,
  extractProviders,
  extractRawDates,
  extractTrailerKey,
  fetchChanges,
  fetchDiscover,
  fetchMovieBundle,
  findTmdbId,
  searchMovies,
} from "./tmdb.ts";

Deno.test("extractRawDates keeps BG/US/GB, maps type 3/4, earliest wins, ignores others", () => {
  const payload = {
    results: [
      {
        iso_3166_1: "US",
        release_dates: [
          { type: 3, release_date: "2026-05-10T00:00:00.000Z" },
          { type: 3, release_date: "2026-05-01T00:00:00.000Z" }, // earlier wins
          { type: 4, release_date: "2026-08-01T00:00:00.000Z" },
          { type: 1, release_date: "2026-01-01T00:00:00.000Z" }, // premiere ignored
        ],
      },
      { iso_3166_1: "FR", release_dates: [{ type: 4, release_date: "2026-06-01T00:00:00.000Z" }] },
      { iso_3166_1: "BG", release_dates: [{ type: 5, release_date: "2026-09-01T00:00:00.000Z" }] },
    ],
  };
  assertEquals(extractRawDates(payload), [
    { region: "US", medium: "theatrical", date: "2026-05-01" },
    { region: "US", medium: "digital", date: "2026-08-01" },
  ]);
});

Deno.test("extractProviders flattens offer types for tracked regions with the region link", () => {
  const payload = {
    results: {
      BG: {
        link: "https://www.themoviedb.org/movie/1/watch?locale=BG",
        flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/n.png", display_priority: 1 }],
        rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.png", display_priority: 3 }],
      },
      DE: { link: "x", flatrate: [{ provider_id: 9, provider_name: "Nope" }] },
    },
  };
  assertEquals(extractProviders(payload), [
    {
      region: "BG", providerId: 8, offerType: "flatrate", providerName: "Netflix",
      logoPath: "/n.png", displayPriority: 1, link: "https://www.themoviedb.org/movie/1/watch?locale=BG",
    },
    {
      region: "BG", providerId: 2, offerType: "rent", providerName: "Apple TV",
      logoPath: "/a.png", displayPriority: 3, link: "https://www.themoviedb.org/movie/1/watch?locale=BG",
    },
  ]);
});

Deno.test("extractGenres maps names, drops junk", () => {
  assertEquals(
    extractGenres({ genres: [{ id: 1, name: "Drama" }, { id: 2, name: "Sci-Fi" }, { id: 3 }, { name: "" }] }),
    ["Drama", "Sci-Fi"],
  );
  assertEquals(extractGenres({}), []);
});

Deno.test("extractTrailerKey prefers official YouTube trailer", () => {
  const json = {
    videos: {
      results: [
        { site: "Vimeo", type: "Trailer", key: "vim", official: true },
        { site: "YouTube", type: "Teaser", key: "teaser", official: true },
        { site: "YouTube", type: "Trailer", key: "unofficial", official: false },
        { site: "YouTube", type: "Trailer", key: "official", official: true },
      ],
    },
  };
  assertEquals(extractTrailerKey(json), "official");
  // No trailer → first YouTube video of any type.
  assertEquals(
    extractTrailerKey({ videos: { results: [{ site: "YouTube", type: "Clip", key: "clip" }] } }),
    "clip",
  );
  assertEquals(extractTrailerKey({}), null);
});

Deno.test("fetchMovieBundle bundles videos+genres and honors regions", async () => {
  const urls: string[] = [];
  const fakeFetch = ((url: unknown) => {
    urls.push(String(url));
    return Promise.resolve(new Response(JSON.stringify({
      title: "M", release_date: "2026-02-03", poster_path: "/p.png",
      overview: "A synopsis.",
      genres: [{ id: 18, name: "Drama" }],
      external_ids: { imdb_id: "tt1" },
      videos: { results: [{ site: "YouTube", type: "Trailer", key: "yt1", official: true }] },
      release_dates: { results: [{ iso_3166_1: "DE", release_dates: [{ type: 4, release_date: "2026-05-01T00:00:00Z" }] }] },
      "watch/providers": { results: {} },
    })));
  }) as typeof fetch;

  const bundle = await fetchMovieBundle(1, "tok", fakeFetch, ["DE"]);
  assertEquals(urls[0].includes("append_to_response=release_dates,watch/providers,external_ids,videos"), true);
  assertEquals(bundle?.overview, "A synopsis.");
  assertEquals(bundle?.genres, ["Drama"]);
  assertEquals(bundle?.trailerKey, "yt1");
  assertEquals(bundle?.rawDates, [{ region: "DE", medium: "digital", date: "2026-05-01" }]);
});

Deno.test("searchMovies trims, maps fields, respects limit", async () => {
  const urls: string[] = [];
  const fakeFetch = ((url: unknown) => {
    urls.push(String(url));
    return Promise.resolve(new Response(JSON.stringify({
      results: Array.from({ length: 20 }, (_, i) => ({
        id: i, title: `M${i}`, release_date: i === 0 ? "2025-06-01" : "", poster_path: i === 0 ? "/p.png" : null, overview: i === 0 ? "o" : "",
      })),
    })));
  }) as typeof fetch;
  const hits = await searchMovies("  dune  ", "tok", fakeFetch, 5);
  assertEquals(urls[0].includes("query=dune"), true);
  assertEquals(hits.length, 5);
  assertEquals(hits[0], { tmdbId: 0, title: "M0", year: 2025, posterPath: "/p.png", overview: "o" });
  assertEquals(hits[1].year, null);
  assertEquals(hits[1].overview, null);
  assertEquals(await searchMovies("   ", "tok", fakeFetch), []);
});

Deno.test("fetchChanges paginates and collects ids", async () => {
  const fakeFetch = ((url: unknown) => {
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return Promise.resolve(new Response(JSON.stringify({
      page, total_pages: 2, results: [{ id: page * 10 }, { id: page * 10 + 1 }],
    })));
  }) as typeof fetch;
  assertEquals(await fetchChanges("2026-07-17", "tok", fakeFetch), [10, 11, 20, 21]);
});

Deno.test("findTmdbId reads movie_results only", async () => {
  const fakeFetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ movie_results: [{ id: 550 }], tv_results: [{ id: 1 }] })))
  ) as typeof fetch;
  assertEquals(await findTmdbId("tt0137523", "tok", fakeFetch), 550);
});

Deno.test("fetchDiscover whitelists filters, paginates, trims to limit", async () => {
  const urls: string[] = [];
  const fakeFetch = ((url: unknown) => {
    urls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get("page"));
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: page * 100 + i, title: `M${page}-${i}`, release_date: "2026-01-01", poster_path: null,
    }));
    return Promise.resolve(new Response(JSON.stringify({ page, total_pages: 5, results })));
  }) as typeof fetch;

  const items = await fetchDiscover(
    { filters: { "sort_by": "popularity.desc", "vote_count.gte": 100, "evil_param": "x" }, limit: 30 },
    "tok",
    fakeFetch,
  );
  assertEquals(items.length, 30);
  assertEquals(urls.length, 2); // ceil(30/20) pages
  const u = new URL(urls[0]);
  assertEquals(u.searchParams.get("sort_by"), "popularity.desc");
  assertEquals(u.searchParams.get("vote_count.gte"), "100");
  assertEquals(u.searchParams.get("evil_param"), null);
});
