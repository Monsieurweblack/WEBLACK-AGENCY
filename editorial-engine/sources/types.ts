export type SourceType = "rss" | "manual";

export interface EditorialSource {
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  priority: number;
  /** Optional: language this source's content is written in, if known ("fr" | "en"). */
  lang?: "fr" | "en";
}

/** Normalized shape of any piece of content entering the pipeline, whatever its origin (RSS item or a manually given URL). */
export interface SourceArticle {
  sourceName: string;
  sourceUrl: string;
  url: string;
  canonicalUrl: string;
  title: string;
  publishedAt: string | undefined;
  author: string | undefined;
  excerpt: string | undefined;
  /** Full extracted text when available — never fabricated; undefined if extraction failed or the source withheld it (paywall, excerpt-only feed). */
  text: string | undefined;
  imageUrl: string | undefined;
  /** SHA-256 of (canonicalUrl + title) — the stable key used for deduplication. */
  hash: string;
}
