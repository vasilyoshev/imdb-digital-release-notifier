import * as cheerio from "cheerio";

async function fetchHtml(url: string, cookie?: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      ...(cookie ? { Cookie: cookie } : {}),
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`IMDb fetch failed: ${res.status}`);
  return await res.text();
}

function extractFromEmbeddedJSON(html: string): string[] {
  const titles = new Set<string>();
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
    /window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});/,
    /IMDbReactInitialState\.push\(\s*(\{[\s\S]*?\})\s*\);?/,
    /IMDbReactInitialState\s*=\s*(\{[\s\S]*?\});/
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[1]);
      const stack = [obj];
      while (stack.length) {
        const cur = stack.pop() as any;
        if (!cur || typeof cur !== "object") continue;
        if (cur.titleText?.text) titles.add(cur.titleText.text);
        if (cur.originalTitleText?.text) titles.add(cur.originalTitleText.text);
        if (typeof cur.primaryText === "string") titles.add(cur.primaryText);
        if (Array.isArray(cur)) stack.push(...cur);
        else for (const k of Object.keys(cur)) stack.push(cur[k]);
      }
    } catch {}
  }
  return Array.from(titles);
}

function extractFromDOM(html: string): string[] {
  const $ = cheerio.load(html);
  const titles = new Set<string>();

  $(".lister-item").each((_, el) => {
    const t = $(el).find(".lister-item-header a").first().text().trim();
    if (t) titles.add(t);
  });

  $("[data-tconst]").each((_, el) => {
    const t =
      $(el).find("h3 a").first().text().trim() ||
      $(el).find(".ipc-title__text").first().text().trim();
    if (t) titles.add(t);
  });

  if (titles.size === 0) {
    $("a[href*='/title/tt']").each((_, a) => {
      const t = $(a).text().trim();
      if (t && /[a-zA-Z]/.test(t) && t.length > 1) titles.add(t);
    });
  }

  return Array.from(titles);
}

export async function fetchWatchlistTitles(): Promise<string[]> {
  const url = process.env.WATCHLIST_URL!;
  if (!url) return [];
  const cookie = process.env.IMDB_COOKIE || "";
  const html = await fetchHtml(url, cookie);
  let titles = extractFromEmbeddedJSON(html);
  if (!titles.length) titles = extractFromDOM(html);
  return Array.from(new Set(titles))
    .map(t => t.replace(/\s+\(\d{4}\)$/, "").trim())
    .filter(Boolean);
}
