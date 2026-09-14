import type { GeneratedArticle } from "../generation/types.ts";
import type { KeywordStrategy } from "../intelligence/keywordStrategy.ts";
import { getSanityClient } from "../sanity/client.ts";
import { log } from "../logs/logger.ts";

export interface InternalLinkSuggestion {
  title: string;
  url: string; // site-relative path, built only from a slug that actually exists in Sanity right now
  relevance: number; // 0-1, keyword/entity overlap — a ranking signal, not a guarantee of relevance
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]+/g) ?? [],
  );
}

/**
 * §14 — every suggestion is built from a real, freshly-queried Sanity
 * document (title + slug fetched live, not cached or guessed), so a link
 * can never point at a page that doesn't exist. Ranked by simple keyword/
 * entity token overlap against the new article's own keyword strategy —
 * no invented relevance judgment beyond that overlap count.
 */
export async function suggestInternalLinks(
  article: GeneratedArticle,
  keywordStrategy: KeywordStrategy,
  limit = 3,
): Promise<InternalLinkSuggestion[]> {
  log("SEO", `Suggestions de maillage interne — ${article.title}`);
  const client = getSanityClient();
  const candidates: { title: string; slug: string }[] = await client.fetch(
    `*[_type == "journal" && lang == $lang && defined(slug.current)]{ title, "slug": slug.current }`,
    { lang: article.lang },
  );

  const articleTokens = new Set([
    ...tokenize(keywordStrategy.primaryKeyword),
    ...keywordStrategy.secondaryKeywords.flatMap((k) => [...tokenize(k)]),
    ...keywordStrategy.entities.flatMap((e) => [...tokenize(e.name)]),
  ]);

  const scored = candidates
    .filter((c) => c.slug !== article.slug)
    .map((c) => {
      const titleTokens = tokenize(c.title);
      let overlap = 0;
      for (const t of titleTokens) if (articleTokens.has(t)) overlap++;
      const relevance = titleTokens.size === 0 ? 0 : overlap / titleTokens.size;
      const localePrefix = article.lang === "en" ? "/en" : "";
      return { title: c.title, url: `${localePrefix}/journal/${c.slug}/`, relevance };
    })
    .filter((s) => s.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);

  return scored;
}
