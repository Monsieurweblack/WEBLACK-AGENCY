import crypto from "node:crypto";
import type { SourceArticle } from "../sources/types.ts";

/** Strips tracking params and trailing slashes so the same article reached via different links dedupes correctly. */
export function canonicalize(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref"];
    for (const p of trackingParams) u.searchParams.delete(p);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return rawUrl.trim();
  }
}

export function hashArticle(canonicalUrl: string, title: string): string {
  return crypto
    .createHash("sha256")
    .update(`${canonicalUrl.toLowerCase()}|${title.trim().toLowerCase()}`)
    .digest("hex");
}

export function buildSourceArticle(input: {
  sourceName: string;
  sourceUrl: string;
  url: string;
  title: string;
  publishedAt?: string;
  author?: string;
  excerpt?: string;
  text?: string;
  imageUrl?: string;
}): SourceArticle {
  const canonicalUrl = canonicalize(input.url);
  return {
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    url: input.url,
    canonicalUrl,
    title: input.title.trim(),
    publishedAt: input.publishedAt,
    author: input.author,
    excerpt: input.excerpt,
    text: input.text,
    imageUrl: input.imageUrl,
    hash: hashArticle(canonicalUrl, input.title),
  };
}
