import { assertEquals } from "jsr:@std/assert@1";
import { fetchImdbRating, parseOmdb } from "./omdb.ts";

Deno.test("parseOmdb reads stringy rating + comma votes, N/A → null", () => {
  assertEquals(parseOmdb({ imdbRating: "7.9", imdbVotes: "1,234,567" }), { imdbRating: 7.9, imdbVotes: 1234567 });
  assertEquals(parseOmdb({ imdbRating: "N/A", imdbVotes: "N/A" }), { imdbRating: null, imdbVotes: null });
  assertEquals(parseOmdb({}), { imdbRating: null, imdbVotes: null });
});

Deno.test("fetchImdbRating hits OMDb by imdb id; False response → null", async () => {
  let url = "";
  const ok = ((u: unknown) => {
    url = String(u);
    return Promise.resolve(new Response(JSON.stringify({ Response: "True", imdbRating: "8.8", imdbVotes: "2,500,000" })));
  }) as typeof fetch;
  assertEquals(await fetchImdbRating("tt1375666", "KEY", ok), { imdbRating: 8.8, imdbVotes: 2500000 });
  assertEquals(url.includes("i=tt1375666"), true);
  assertEquals(url.includes("apikey=KEY"), true);

  const notFound = (() => Promise.resolve(new Response(JSON.stringify({ Response: "False", Error: "Incorrect IMDb ID." })))) as typeof fetch;
  assertEquals(await fetchImdbRating("tt0", "KEY", notFound), null);
});
