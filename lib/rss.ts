import RSSParser from "rss-parser";
const parser = new RSSParser();
export type FeedItem = { title: string; link?: string; pubDate?: string };

export async function getFeedItems(feedUrl: string): Promise<FeedItem[]> {
  const feed = await parser.parseURL(feedUrl);
  return (feed.items || []).map((it) => ({
    title: it.title || "",
    link: it.link,
    pubDate: (it as any).isoDate || it.pubDate,
  }));
}
