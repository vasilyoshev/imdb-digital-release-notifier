import RSSParser from "rss-parser";
const parser = new RSSParser();
export type FeedItem = { title: string; link?: string; pubDate?: string };

export const getFeedItems = async (): Promise<FeedItem[]> => {
  const feed = await parser.parseURL("https://feeds.feedburner.com/DVDsReleaseDates");
  return (feed.items || []).map((it) => ({
    title: it.title || "",
  }));
};
