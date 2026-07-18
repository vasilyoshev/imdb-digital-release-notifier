import { assertEquals } from "jsr:@std/assert@1";
import {
  buildManifest,
  fetchCatalog,
  parseExtras,
  type RadarMovieRow,
  toMeta,
  windowForCatalog,
} from "./stremio-core.ts";

Deno.test("manifest: two catalogs, region-in-genre, optional extras", () => {
  const m = buildManifest();
  assertEquals(m.id, "uk.yoshevbot.release-notifier.radar");
  assertEquals(m.idPrefixes, ["tt"]);
  assertEquals(m.catalogs.map((c) => c.id), ["new-digital", "upcoming-digital"]);
  const genre = m.catalogs[0].extra.find((e) => e.name === "genre");
  assertEquals(genre?.options, ["US", "BG", "GB", "DE"]);
  assertEquals(genre?.isRequired, false);
});

Deno.test("windowForCatalog maps catalog ids to windows", () => {
  assertEquals(windowForCatalog("new-digital"), "recent");
  assertEquals(windowForCatalog("upcoming-digital"), "upcoming");
  assertEquals(windowForCatalog("bogus"), null);
});

Deno.test("parseExtras: region + skip, defaults, unknown region → US", () => {
  assertEquals(parseExtras(undefined), { region: "US", skip: 0 });
  assertEquals(parseExtras("genre=BG&skip=100"), { region: "BG", skip: 100 });
  assertEquals(parseExtras(encodeURIComponent("genre=GB&skip=200")), { region: "GB", skip: 200 });
  assertEquals(parseExtras("genre=ZZ"), { region: "US", skip: 0 }); // unsupported → US
  assertEquals(parseExtras("skip=-5"), { region: "US", skip: 0 }); // negative ignored
});

Deno.test("toMeta: tt id, digital-date-led description, poster url; skips no-imdb", () => {
  const row: RadarMovieRow = {
    digital_date: "2026-07-15",
    movies: { imdb_id: "tt123", title: "Alpha", poster_path: "/p.png", year: 2024, overview: "A film." },
  };
  assertEquals(toMeta(row), {
    id: "tt123",
    type: "movie",
    name: "Alpha",
    poster: "https://image.tmdb.org/t/p/w342/p.png",
    posterShape: "poster",
    description: "Digital: 2026-07-15\n\nA film.",
    releaseInfo: "2024",
  });
  assertEquals(toMeta({ digital_date: "2026-01-01", movies: { imdb_id: null, title: "X", poster_path: null, year: null, overview: null } }), null);
});

Deno.test("fetchCatalog builds the anon PostgREST query and maps metas", async () => {
  let calledUrl = "";
  const fakeFetch = ((url: unknown) => {
    calledUrl = String(url);
    const rows: RadarMovieRow[] = [
      { digital_date: "2026-07-10", movies: { imdb_id: "tt1", title: "One", poster_path: null, year: 2025, overview: null } },
      { digital_date: "2026-07-09", movies: { imdb_id: null, title: "Two", poster_path: null, year: 2025, overview: null } },
    ];
    return Promise.resolve(new Response(JSON.stringify(rows)));
  }) as typeof fetch;

  const metas = await fetchCatalog("https://db", "anon", "recent", "BG", 100, fakeFetch);
  assertEquals(calledUrl.includes("/rest/v1/radar_entries?"), true);
  assertEquals(calledUrl.includes("region=eq.BG"), true);
  assertEquals(calledUrl.includes("window=eq.recent"), true);
  assertEquals(calledUrl.includes("offset=100"), true);
  assertEquals(calledUrl.includes("limit=100"), true);
  assertEquals(metas.map((m) => m.id), ["tt1"]); // the no-imdb row dropped
});
