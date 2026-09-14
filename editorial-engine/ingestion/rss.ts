import Parser from "rss-parser";
import type { EditorialSource, SourceArticle } from "../sources/types.ts";
import { buildSourceArticle } from "./normalize.ts";
import { log } from "../logs/logger.ts";

const parser = new Parser({ timeout: 15_000 });

/**
 * Fetches an RSS/Atom feed and returns normalized SourceArticles. Only uses
 * what the feed itself publishes (title/link/pubDate/creator/contentSnippet/
 * content/enclosure) — never follows the link to scrape the full page here
 * (that is a separate, explicit step via ingestion/url.ts, since not every
 * source's terms permit full-page fetching even when the feed is public).
 */
export async function fetchRssSource(source: EditorialSource): Promise<SourceArticle[]> {
  log("FETCH", `RSS ${source.name} (${source.url})`);
  const feed = await parser.parseURL(source.url);
  const items = feed.items ?? [];
  return items
    .filter((item) => item.link && item.title)
    .map((item) =>
      buildSourceArticle({
        sourceName: source.name,
        sourceUrl: source.url,
        url: item.link!,
        title: item.title!,
        publishedAt: item.isoDate ?? item.pubDate,
        author: item.creator ?? item.author,
        excerpt: item.contentSnippet,
        text: item["content:encoded"] ?? item.content,
        imageUrl: item.enclosure?.url,
      }),
    );
}
