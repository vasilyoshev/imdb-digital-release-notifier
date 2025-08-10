import { fetchWatchlistTitles } from "../../../../lib/imdb";
import { sendMatchesEmail } from "../../../../lib/mail";
import { isMatch, normalize } from "../../../../lib/matcher";
import { getFeedItems } from "../../../../lib/rss";
import { readStore, writeStore } from "../../../../lib/storage";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await readStore();
  const titles = await fetchWatchlistTitles();

  const items = await getFeedItems(process.env.FEED_URL!);
  const matches: { wishlist: string; feedTitle: string; link?: string; pubDate?: string; }[] = [];

  for (const it of items) {
    const feedTitle = (it.title || "").replace(/\s+-\s+.*$/, "").trim();
    for (const t of titles) {
      if (isMatch(feedTitle, t)) {
        const key = `${normalize(t)}|${it.link}`;
        if (!store.knownItems.includes(key)) {
          matches.push({ wishlist: t, feedTitle: it.title, link: it.link, pubDate: it.pubDate });
          store.knownItems.push(key);
        }
        break;
      }
    }
  }

  store.titles = titles;
  await writeStore(store);

  if (matches.length) await sendMatchesEmail(matches);

  return Response.json({ ok: true, titles: titles.length, feedItems: items.length, newMatches: matches.length });
}
