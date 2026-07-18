// OMDb API — the free source for the real IMDb rating + vote count, keyed by
// imdb id. Optional: without OMDB_API_KEY the pipeline just leaves imdb_rating /
// imdb_votes NULL (TMDB's rating still shows). Keep the OMDb-specific parsing here.

export interface ImdbRating {
  imdbRating: number | null;
  imdbVotes: number | null;
}

/** Parse OMDb's stringy fields: `imdbRating: "7.9"`, `imdbVotes: "1,234,567"`,
 * either possibly "N/A". */
// deno-lint-ignore no-explicit-any
export function parseOmdb(json: any): ImdbRating {
  const rating = Number(json?.imdbRating);
  const votes = Number(String(json?.imdbVotes ?? "").replace(/,/g, ""));
  return {
    imdbRating: Number.isFinite(rating) && rating > 0 ? rating : null,
    imdbVotes: Number.isFinite(votes) && votes > 0 ? votes : null,
  };
}

/** Fetch the IMDb rating + votes for one imdb id, or null on any failure (the
 * caller treats null as "leave the columns as-is"). */
export async function fetchImdbRating(
  imdbId: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<ImdbRating | null> {
  try {
    const res = await fetchFn(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${apiKey}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.Response === "False") return null;
    return parseOmdb(json);
  } catch {
    return null;
  }
}
