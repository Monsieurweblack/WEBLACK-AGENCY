import { getSanityClient } from "../sanity/client.ts";
import { log } from "../logs/logger.ts";

export interface FreshnessFlag {
  documentId: string;
  title: string;
  slug: string;
  category: string;
  format: string | undefined;
  publishDate: string;
  updatedAt: string;
  daysSinceUpdate: number;
  reason: string;
}

/**
 * §16 — a real, local heuristic over the actual `journal` documents in
 * Sanity: flags articles that were NEVER touched since publication
 * (`_updatedAt === publishDate`, i.e. `dateModified` has never moved) and
 * are old enough that their category/format suggests they cover something
 * that could have developed since (a "news"/"report" item, or one in a
 * fast-moving category). This never inspects the original source again
 * (no re-crawl, no network call beyond Sanity) and never rewrites
 * `publishDate` — flags are read-only signals for a human to act on.
 */
export async function detectStaleArticles(daysThreshold = 90): Promise<FreshnessFlag[]> {
  log("SEO", `Détection de fraîcheur de contenu (seuil ${daysThreshold} jours)`);
  const client = getSanityClient();
  const docs: {
    _id: string;
    title: string;
    slug: string;
    category: string;
    format?: string;
    publishDate: string;
    _updatedAt: string;
    _createdAt: string;
  }[] = await client.fetch(
    `*[_type == "journal" && defined(slug.current)]{ _id, title, "slug": slug.current, category, format, publishDate, _updatedAt, _createdAt }`,
  );

  const flags: FreshnessFlag[] = [];
  for (const doc of docs) {
    const daysSinceUpdate = (Date.now() - new Date(doc._updatedAt).getTime()) / 86_400_000;
    const neverUpdatedSinceCreation = Math.abs(new Date(doc._updatedAt).getTime() - new Date(doc._createdAt).getTime()) < 60_000;

    if (daysSinceUpdate < daysThreshold) continue;

    if ((doc.format === "news" || doc.category === "news" || doc.category === "reports") && neverUpdatedSinceCreation) {
      flags.push({
        documentId: doc._id,
        title: doc.title,
        slug: doc.slug,
        category: doc.category,
        format: doc.format,
        publishDate: doc.publishDate,
        updatedAt: doc._updatedAt,
        daysSinceUpdate: Math.round(daysSinceUpdate),
        reason: `Article "${doc.format ?? doc.category}" jamais mis à jour depuis sa publication, ${Math.round(daysSinceUpdate)} jours — un développement (nouveau statut, résultat, nomination) a pu se produire depuis.`,
      });
    }
  }
  return flags;
}
