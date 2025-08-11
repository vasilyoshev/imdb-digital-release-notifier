import { readStore } from "../../../../lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await readStore();
  return Response.json({
    watchlistUrl: process.env.WATCHLIST_URL,
    titleCount: s.titles.length,
    knownCount: s.knownItems.length,
  });
}
