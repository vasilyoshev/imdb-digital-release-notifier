import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fetchWatchlist, parseImdbUserId, WatchlistPrivateError } from "./imdb.ts";

Deno.test("parseImdbUserId accepts profile URL, watchlist URL, and bare id", () => {
  assertEquals(parseImdbUserId("https://www.imdb.com/user/ur27331503/watchlist/"), "ur27331503");
  assertEquals(parseImdbUserId("https://www.imdb.com/user/ur27331503/"), "ur27331503");
  assertEquals(parseImdbUserId("ur27331503"), "ur27331503");
});

Deno.test("parseImdbUserId rejects opaque slugs and junk", () => {
  assertEquals(parseImdbUserId("https://www.imdb.com/user/p.abc123xyz/"), null);
  assertEquals(parseImdbUserId("https://www.imdb.com/list/ls050920959/"), null);
  assertEquals(parseImdbUserId("urban"), null);
});

function page(edges: unknown[], hasNext: boolean, endCursor: string | null) {
  return {
    data: {
      predefinedList: {
        id: "ls1", items: { total: 3, edges, pageInfo: { hasNextPage: hasNext, endCursor } },
      },
    },
  };
}
const title = (id: string, type = "movie") => ({
  node: { listItem: { id, titleText: { text: `T ${id}` }, releaseYear: { year: 2020 }, titleType: { id: type } } },
});

Deno.test("fetchWatchlist paginates and keeps only movies", async () => {
  const pages = [
    page([title("tt1"), title("tt2", "tvSeries")], true, "CUR1"),
    page([title("tt3")], false, null),
  ];
  let call = 0;
  const fakeFetch = ((_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (call === 1) assertEquals(body.variables.after, "CUR1");
    return Promise.resolve(new Response(JSON.stringify(pages[call++])));
  }) as typeof fetch;

  const items = await fetchWatchlist("ur27331503", fakeFetch);
  assertEquals(items.map((i: { imdbId: string }) => i.imdbId), ["tt1", "tt3"]);
  assertEquals(items[0], { imdbId: "tt1", title: "T tt1", year: 2020 });
});

Deno.test("fetchWatchlist surfaces private lists as WatchlistPrivateError", async () => {
  const fakeFetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ errors: [{ message: "FORBIDDEN", extensions: { code: "FORBIDDEN" } }] })),
    )) as typeof fetch;
  await assertRejects(() => fetchWatchlist("ur0", fakeFetch), WatchlistPrivateError);
});
