export type SourceType = "rss" | "manual";

export interface EditorialSource {
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  priority: number;
  /** Optional: language this source's content is written in, if known ("fr" | "en"). */
  lang?: "fr" | "en";
  /**
   * How many of the feed's newest items one production cycle may take.
   * Feeds differ wildly in size — Dezeen publishes 50 items where another
   * publishes 12 — and every item costs real model calls whether or not it
   * ever becomes a draft. Capping per source keeps a cycle's cost bounded
   * and predictable instead of hostage to whoever published most today.
   */
  maxItemsPerCycle?: number;
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
  /** SHA-256 of (canonicalUrl + title) — the stable key used for deduplication Level 1/exact-hash matching. */
  hash: string;
  /** SHA-256 of the body text alone (§1 Level 2) — undefined when no substantial body text was extracted. */
  contentHash?: string;
}
