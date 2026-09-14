import type { GeneratedArticle } from "../generation/types.ts";
import type { KeywordStrategy } from "../intelligence/keywordStrategy.ts";
import type { InternalLinkSuggestion } from "./internalLinking.ts";
import { checkSeoTitle, checkSeoDescription, slugify } from "./seo.ts";

export interface SeoQualityGateResult {
  seoScore: number; // 0-100
  issues: string[];
  /** A low SEO score never blocks publication on its own (§18) — this flag documents that explicitly rather than leaving it implicit. */
  blocksPublication: false;
}

function hasHeading(article: GeneratedArticle): boolean {
  return article.body.some((b) => b._type === "block" && b.style !== "normal" && b.style !== "blockquote");
}

function keywordInTitleOrExcerpt(article: GeneratedArticle, primaryKeyword: string): boolean {
  const haystack = `${article.title} ${article.excerpt}`.toLowerCase();
  return haystack.includes(primaryKeyword.toLowerCase());
}

/**
 * §18 — every point checked here is something the engine can verify from
 * data it already has; nothing about actual search performance (that
 * requires Search Console, see intelligence/searchConsole.ts) is claimed.
 * A low score is informational, never a gate on its own — matches the
 * brief's explicit "un mauvais score SEO ne doit pas automatiquement
 * entraîner la publication [ni le bloquer]" read together with the main
 * Quality Gate (validation/qualityGate.ts), which is the one that decides
 * publish/draft/reject.
 */
export function evaluateSeoQualityGate(
  article: GeneratedArticle,
  keywordStrategy: KeywordStrategy | undefined,
  internalLinks: InternalLinkSuggestion[],
): SeoQualityGateResult {
  const issues: string[] = [];
  let points = 0;
  const MAX_POINTS = 9;

  const titleCheck = checkSeoTitle(article.seo?.title ?? "");
  if (titleCheck.ok) points++;
  else issues.push(...titleCheck.issues);

  const descCheck = checkSeoDescription(article.seo?.description ?? "");
  if (descCheck.ok) points++;
  else issues.push(...descCheck.issues);

  const expectedSlug = slugify(article.title);
  if (article.slug === expectedSlug && article.slug.length > 0) points++;
  else issues.push(`Slug "${article.slug}" ne correspond pas à une slugification propre du titre`);

  if (keywordStrategy) {
    if (keywordInTitleOrExcerpt(article, keywordStrategy.primaryKeyword)) points++;
    else issues.push(`Mot-clé principal "${keywordStrategy.primaryKeyword}" absent du titre et de l'excerpt`);
  } else {
    issues.push("Stratégie de mots-clés indisponible — impossible de vérifier la présence du mot-clé principal");
  }

  if (hasHeading(article) || article.body.length <= 3) points++; // a short article legitimately needs no subheading
  else issues.push("Aucun intertitre (H2/H3) dans un article de plusieurs paragraphes");

  const wordCount = article.body
    .filter((b) => b._type === "block")
    .reduce((sum, b) => sum + (b._type === "block" ? b.children.map((c) => c.text).join(" ").split(/\s+/).filter(Boolean).length : 0), 0);
  if (wordCount >= 80) points++;
  else issues.push(`Contenu court (${wordCount} mots) — peu de matière pour un bon référencement`);

  if (internalLinks.length > 0) points++;
  else issues.push("Aucun lien interne suggéré — occasion de maillage manquée");

  if (article.coverImage?.alt) points++;
  else if (article.coverImage) issues.push("Image de couverture sans texte alternatif");
  else points++; // no image at all is a valid, deliberate choice (§12 of the prior phase) — not a SEO fault

  // "Indexability": every field the site actually needs to render and index the page is present.
  if (article.title && article.slug && article.excerpt && article.author) points++;
  else issues.push("Champs requis pour l'indexation manquants (titre/slug/excerpt/auteur)");

  return { seoScore: Math.round((points / MAX_POINTS) * 100), issues, blocksPublication: false };
}
