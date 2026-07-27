/**
 * Contract tests for the personalized addon logic (map #109). This module is
 * shared by the Worker and the /configure page, so a regression here silently
 * changes what Stremio serves — the config-array contract (#116), the manifest
 * shape, and the filter/sort pipeline are all pinned below.
 *
 * Run: npm run test:worker
 */
import { assertEquals } from "jsr:@std/assert";
import {
  buildListMetas,
  buildPersonalManifest,
  type CatalogDef,
  defaultCatalogs,
  isRadarSource,
  listIdOfSource,
  type ListRow,
  parseCatalogs,
  type TokenList,
} from "./personal.ts";

const LISTS: TokenList[] = [
  { id: 1, name: "Watchlist", kind: "imdb_watchlist" },
  { id: 3, name: "Followed", kind: "manual" },
];

const TODAY = "2026-07-26";

function row(over: Partial<ListRow> & { imdb_id: string | null }): ListRow {
  return {
    tmdb_id: 1,
    title: "Untitled",
    year: 2020,
    poster_path: null,
    overview: null,
    digital_date: null,
    theatrical_date: null,
    imdb_rating: null,
    imdb_votes: null,
    tmdb_rating: null,
    tmdb_votes: null,
    popularity: null,
    added_at: null,
    ...over,
  };
}

function def(over: Partial<CatalogDef> = {}): CatalogDef {
  return {
    id: "c-test",
    name: "Test",
    source: "list-1",
    enabled: true,
    sort: { key: "digital", dir: "desc" },
    minVotes: null,
    status: null,
    region: "US",
    ...over,
  };
}

// ---- source helpers -------------------------------------------------------

Deno.test("listIdOfSource parses list sources and rejects radar ones", () => {
  assertEquals(listIdOfSource("list-42"), 42);
  assertEquals(listIdOfSource("new-digital"), null);
  assertEquals(listIdOfSource("list-"), null);
});

Deno.test("isRadarSource recognises exactly the two radar windows", () => {
  assertEquals(isRadarSource("new-digital"), true);
  assertEquals(isRadarSource("upcoming-digital"), true);
  assertEquals(isRadarSource("list-1"), false);
});

// ---- config resolution (#116 contract) ------------------------------------

Deno.test("an empty config resolves to one catalog per list plus both radar windows", () => {
  const defs = parseCatalogs({}, LISTS);
  assertEquals(defs.map((d) => d.id), [
    "list-1",
    "list-3",
    "new-digital",
    "upcoming-digital",
  ]);
  assertEquals(defs.map((d) => d.name), [
    "Watchlist",
    "Followed",
    "New on digital",
    "Upcoming digital",
  ]);
  // Same resolution the page shows, so the two can't drift.
  assertEquals(defs, defaultCatalogs(LISTS));
});

Deno.test("a legacy object-shaped config falls back to the defaults, not an empty addon", () => {
  // Pre-#116 configs keyed catalogs by id instead of listing them.
  const legacy = { catalogs: { "list-1": { enabled: false } } };
  assertEquals(parseCatalogs(legacy, LISTS), defaultCatalogs(LISTS));
});

Deno.test("stored catalogs keep their order and may repeat a source with different filters", () => {
  const defs = parseCatalogs(
    {
      catalogs: [
        { id: "c-b", name: "Out now by rating", source: "list-1", sort: { key: "rating", dir: "desc" }, status: "Out now" },
        { id: "c-a", name: "Coming soon", source: "list-1", sort: { key: "digital", dir: "asc" }, status: "Announced" },
      ],
    },
    LISTS,
  );
  assertEquals(defs.map((d) => d.id), ["c-b", "c-a"]);
  assertEquals(defs[0].sort, { key: "rating", dir: "desc" });
  assertEquals(defs[1].sort, { key: "digital", dir: "asc" });
  assertEquals(defs.map((d) => d.status), ["Out now", "Announced"]);
});

Deno.test("entries that can't identify a real source are dropped, not fatal", () => {
  const defs = parseCatalogs(
    {
      catalogs: [
        { id: "ok", source: "list-1" },
        { id: "no-source" },
        { id: "deleted-list", source: "list-999" },
        { source: "list-1" }, // no id
        null,
        "nonsense",
      ],
    },
    LISTS,
  );
  assertEquals(defs.map((d) => d.id), ["ok"]);
});

Deno.test("a nameless entry falls back to its source's own name", () => {
  const defs = parseCatalogs(
    { catalogs: [{ id: "a", source: "list-3" }, { id: "b", source: "new-digital", name: "  " }] },
    LISTS,
  );
  assertEquals(defs.map((d) => d.name), ["Followed", "New on digital"]);
});

Deno.test("out-of-vocabulary option values fall back to defaults instead of reaching Stremio", () => {
  const [d] = parseCatalogs(
    {
      catalogs: [{
        id: "junk",
        source: "list-1",
        sort: { key: "definitely-not-a-key", dir: "sideways" },
        minVotes: -5,
        status: "Nope",
        region: "usa",
      }],
    },
    LISTS,
  );
  assertEquals(d.sort, { key: "digital", dir: "desc" });
  assertEquals(d.minVotes, null);
  assertEquals(d.status, null);
  assertEquals(d.region, "US");
  assertEquals(d.enabled, true);
});

// ---- manifest -------------------------------------------------------------

Deno.test("the manifest lists only enabled catalogs, in order, with source-appropriate extras", () => {
  const manifest = buildPersonalManifest({
    config: {
      catalogs: [
        { id: "a", name: "Mine", source: "list-1" },
        { id: "off", source: "list-3", enabled: false },
        { id: "r", name: "Radar BG", source: "upcoming-digital", region: "BG" },
      ],
    },
    lists: LISTS,
  });
  assertEquals(manifest.catalogs.map((c) => `${c.id}:${c.name}`), ["a:Mine", "r:Radar BG"]);
  // Radar catalogs expose the in-Stremio region dropdown; list catalogs don't.
  assertEquals(manifest.catalogs[0].extra.map((e) => (e as { name: string }).name), ["skip"]);
  assertEquals(manifest.catalogs[1].extra.map((e) => (e as { name: string }).name), [
    "genre",
    "skip",
  ]);
  assertEquals(manifest.behaviorHints, { configurable: true, configurationRequired: false });
});

Deno.test("a dead token yields an empty-catalog manifest, never a broken install", () => {
  const manifest = buildPersonalManifest(null);
  assertEquals(manifest.catalogs, []);
  assertEquals(manifest.resources, ["catalog"]);
  // The description is where a stranded install learns what to do.
  assertEquals(manifest.description.includes("/configure"), true);
});

// ---- catalog rows ---------------------------------------------------------

const ROWS: ListRow[] = [
  row({ imdb_id: "tt-out-high", title: "Out, well rated", digital_date: "2024-01-01", imdb_rating: 8.5, imdb_votes: 50_000 }),
  row({ imdb_id: "tt-out-low", title: "Out, few votes", digital_date: "2024-02-01", imdb_rating: 9.9, imdb_votes: 500 }),
  row({ imdb_id: "tt-soon", title: "Announced", digital_date: "2099-01-01", imdb_rating: 7.0, imdb_votes: 99_999 }),
  row({ imdb_id: "tt-out-mid", title: "Out, mid rated", digital_date: "2023-05-05", imdb_rating: 6.1, imdb_votes: 20_000 }),
  row({ imdb_id: null, title: "No IMDb id", digital_date: "2024-01-01", tmdb_rating: 9, tmdb_votes: 9999 }),
];

Deno.test("rows without an IMDb id are dropped — Stremio keys metas on tt ids", () => {
  const metas = buildListMetas(ROWS, def(), 0, TODAY);
  assertEquals(metas.some((m) => m.name === "No IMDb id"), false);
  assertEquals(metas.length, 4);
});

Deno.test("the status filter and the vote floor compose, then the sort applies", () => {
  const metas = buildListMetas(
    ROWS,
    def({ status: "Out now", minVotes: 1000, sort: { key: "rating", dir: "desc" } }),
    0,
    TODAY,
  );
  // "Announced" excluded by status; the 500-vote row by the floor; then rating desc.
  assertEquals(metas.map((m) => m.id), ["tt-out-high", "tt-out-mid"]);
});

Deno.test("one row set through two catalogs yields two different catalogs", () => {
  const outNow = buildListMetas(ROWS, def({ status: "Out now", minVotes: 1000 }), 0, TODAY);
  const announced = buildListMetas(ROWS, def({ status: "Announced" }), 0, TODAY);
  assertEquals(outNow.map((m) => m.id), ["tt-out-high", "tt-out-mid"]);
  assertEquals(announced.map((m) => m.id), ["tt-soon"]);
});

Deno.test("sort direction flips the order", () => {
  const desc = buildListMetas(ROWS, def({ sort: { key: "digital", dir: "desc" } }), 0, TODAY);
  const asc = buildListMetas(ROWS, def({ sort: { key: "digital", dir: "asc" } }), 0, TODAY);
  assertEquals(desc.map((m) => m.id), [...asc.map((m) => m.id)].reverse());
});

Deno.test("skip paginates within the sorted result", () => {
  const all = buildListMetas(ROWS, def(), 0, TODAY);
  const skipped = buildListMetas(ROWS, def(), 2, TODAY);
  assertEquals(skipped.map((m) => m.id), all.slice(2).map((m) => m.id));
});

Deno.test("a meta carries the poster, release year and digital date Stremio renders", () => {
  const [meta] = buildListMetas(
    [row({ imdb_id: "tt1", title: "Solaris", year: 1972, poster_path: "/p.jpg", overview: "Ocean.", digital_date: "2024-03-04" })],
    def(),
    0,
    TODAY,
  );
  assertEquals(meta.id, "tt1");
  assertEquals(meta.type, "movie");
  assertEquals(meta.name, "Solaris");
  assertEquals(meta.poster, "https://image.tmdb.org/t/p/w342/p.jpg");
  assertEquals(meta.releaseInfo, "1972");
  assertEquals(meta.description, "Digital: 2024-03-04\n\nOcean.");
});
