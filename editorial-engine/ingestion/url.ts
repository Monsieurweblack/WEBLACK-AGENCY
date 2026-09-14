import { extract } from "@extractus/article-extractor";
import type { SourceArticle } from "../sources/types.ts";
import { buildSourceArticle } from "./normalize.ts";
import { log } from "../logs/logger.ts";

/**
 * Fetches and extracts a single article from a manually-given URL. Only
 * reads what the page itself serves publicly (no login, no paywall bypass,
 * no headless-browser trick to get around access restrictions) — if
 * extraction fails or returns no body text, that is reported as-is, never
 * papered over with invented content.
 */
export async function fetchManualUrl(url: string): Promise<SourceArticle> {
  log("FETCH", `URL manuelle ${url}`);
  const article = await extract(url);
  if (!article || !article.title) {
    throw new Error(`Impossible d'extraire un article depuis ${url} (page inaccessible, protégée, ou sans contenu détectable).`);
  }
  return buildSourceArticle({
    // article-extractor already resolves the real publication domain into
    // `source` (e.g. "startupfashion.com") — using it instead of the old
    // literal "manual" fixes references/citations actually naming the
    // outlet. Never fabricated: `source` is either the extractor's own
    // resolved value or the URL's own hostname, both real.
    sourceName: article.source || new URL(url).hostname,
    sourceUrl: url,
    url,
    title: article.title,
    publishedAt: article.published ?? undefined,
    author: article.author ?? undefined,
    excerpt: article.description ?? undefined,
    text: article.content ? stripHtml(article.content) : undefined,
    imageUrl: article.image ?? undefined,
  });
}

/** article-extractor returns sanitized HTML; the generation step wants plain text so the model works from facts, not markup. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
