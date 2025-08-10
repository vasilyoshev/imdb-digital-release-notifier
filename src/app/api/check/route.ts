import { isMatch } from "../../../../lib/matcher";
import { getFeedItems } from "../../../../lib/rss";
import { readStore } from "../../../../lib/storage";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await readStore();
  const items = await getFeedItems(process.env.FEED_URL!);

  const found = [];
  for (const it of items) {
    const feedTitle = (it.title || "").replace(/\s+-\s+.*$/, "").trim();
    for (const t of store.titles) {
      if (isMatch(feedTitle, t)) {
        found.push({ wishlist: t, feedTitle: it.title, link: it.link, pubDate: it.pubDate });
        break;
      }
    }
  }
  return Response.json({ ok: true, matches: found });
}
