import { createClient, type SanityClient } from "@sanity/client";
import { toHTML } from "@portabletext/to-html";
import type { PortableTextBlock } from "@portabletext/types";
import type { Lang } from "../i18n/utils";

export const sanityClient: SanityClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET,
  apiVersion: "2025-01-01",
  useCdn: true,
});

export interface ImageCredit {
  photographer: string;
  photographerUrl?: string;
}

export interface EntryImage {
  url: string;
  alt: string;
  width: number;
  height: number;
  credit?: ImageCredit;
}

export interface EntryLocation {
  city: string;
  country: string;
}

export interface Seo {
  title?: string;
  description?: string;
}

export type TalentCategory =
  | "models"
  | "creatives"
  | "artists"
  | "designers"
  | "photographers"
  | "stylists"
  | "other";

export type JournalCategory =
  | "projects"
  | "interviews"
  | "insights"
  | "culture"
  | "talent-stories"
  | "industry-perspectives"
  | "news"
  | "fashion"
  | "designers"
  | "fashion-weeks"
  | "reports";

/**
 * Canonical editorial ordering for category tabs. Pages derive the actual
 * tab set from published articles (never show a tab with nothing behind
 * it) but sort it against this order for a stable, intentional sequence.
 */
export const JOURNAL_CATEGORY_ORDER: JournalCategory[] = [
  "news",
  "fashion",
  "designers",
  "fashion-weeks",
  "industry-perspectives",
  "culture",
  "interviews",
  "insights",
  "talent-stories",
  "reports",
  "projects",
];

export interface TalentData {
  slug: string;
  lang: Lang;
  name: string;
  role: string;
  category: TalentCategory;
  country: string;
  specialties?: string[];
  portraitImage: EntryImage;
  gallery?: EntryImage[];
  instagram?: string;
  portfolioUrl?: string;
  highlights?: string[];
  bioHtml: string;
  featured: boolean;
  seo?: Seo;
}

export interface WorkData {
  slug: string;
  lang: Lang;
  title: string;
  client: string;
  year: number;
  startDate: Date;
  location: EntryLocation;
  disciplines: string[];
  context: string;
  challenge: string;
  role: string;
  creativeResponse: string;
  coverImage: EntryImage;
  galleryImages?: EntryImage[];
  results?: string[];
  relatedWorkSlugs?: string[];
  featured: boolean;
  seo?: Seo;
}

export interface JournalData {
  slug: string;
  lang: Lang;
  title: string;
  excerpt: string;
  category: JournalCategory;
  publishDate: Date;
  updatedAt: Date;
  author?: string;
  coverImage: EntryImage;
  relatedWorkSlug?: string;
  bodyHtml: string;
  readTimeMinutes: number;
  featured: boolean;
  seo?: Seo;
}

export interface PartnerData {
  slug: string;
  lang: Lang;
  name: string;
  description: string;
  location: EntryLocation;
  coverImage: EntryImage;
  relatedWorkSlug?: string;
  seo?: Seo;
}

export interface TalentEntry {
  data: TalentData;
}
export interface WorkEntry {
  data: WorkData;
}
export interface JournalEntry {
  data: JournalData;
}
export interface PartnerEntry {
  data: PartnerData;
}

interface CollectionMap {
  talent: TalentEntry;
  work: WorkEntry;
  journal: JournalEntry;
  partners: PartnerEntry;
}

export type CollectionKey = keyof CollectionMap;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Resolves a Sanity image asset reference (`image-{id}-{w}x{h}-{format}`)
 * to a real CDN URL. No @sanity/image-url dependency needed — the
 * reference format is stable and documented by Sanity.
 */
function sanityImageUrl(ref: string | undefined): string | null {
  if (!ref) return null;
  const match = ref.match(/^image-([a-f0-9]+)-(\d+x\d+)-(\w+)$/);
  if (!match) return null;
  const [, id, dimensions, format] = match;
  const projectId = import.meta.env.SANITY_PROJECT_ID;
  const dataset = import.meta.env.SANITY_DATASET;
  return `https://cdn.sanity.io/images/${projectId}/${dataset}/${id}-${dimensions}.${format}?w=1600&auto=format`;
}

/**
 * Renders portable text to HTML, including inline image blocks (used by
 * both talent bios and journal article bodies) — a plain block-content
 * field embeds images the same way whether the editor is writing a bio
 * or an article body, so one renderer serves both.
 */
function toHtmlSafe(blocks: (PortableTextBlock | { _type: "image"; asset?: { _ref?: string }; alt?: string; caption?: string })[] | undefined): string {
  if (!blocks || blocks.length === 0) return "";
  return toHTML(blocks, {
    components: {
      types: {
        image: ({ value }) => {
          const url = sanityImageUrl(value?.asset?._ref);
          if (!url) return "";
          const alt = escapeAttr(value.alt ?? "");
          const caption = value.caption ? `<figcaption>${escapeAttr(value.caption)}</figcaption>` : "";
          return `<figure><img src="${url}" alt="${alt}" loading="lazy" />${caption}</figure>`;
        },
      },
    },
  });
}

const WORDS_PER_MINUTE = 200;

function estimateReadTime(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function mapEntry<C extends CollectionKey>(collection: C, doc: any): CollectionMap[C] {
  const slug = doc.slug.current as string;
  switch (collection) {
    case "talent":
      return {
        data: {
          slug,
          lang: doc.lang,
          name: doc.name,
          role: doc.role,
          category: doc.category,
          country: doc.country,
          specialties: doc.specialties,
          portraitImage: doc.portraitImage,
          gallery: doc.gallery,
          instagram: doc.instagram,
          portfolioUrl: doc.portfolioUrl,
          highlights: doc.highlights,
          bioHtml: toHtmlSafe(doc.bio),
          featured: doc.featured ?? false,
          seo: doc.seo,
        },
      } as CollectionMap[C];
    case "work":
      return {
        data: {
          slug,
          lang: doc.lang,
          title: doc.title,
          client: doc.client,
          year: doc.year,
          startDate: new Date(doc.startDate),
          location: doc.location,
          disciplines: doc.disciplines,
          context: doc.context,
          challenge: doc.challenge,
          role: doc.role,
          creativeResponse: doc.creativeResponse,
          coverImage: doc.coverImage,
          galleryImages: doc.galleryImages,
          results: doc.results,
          relatedWorkSlugs: doc.relatedWorkSlugs,
          featured: doc.featured ?? false,
          seo: doc.seo,
        },
      } as CollectionMap[C];
    case "journal": {
      const bodyHtml = toHtmlSafe(doc.body);
      return {
        data: {
          slug,
          lang: doc.lang,
          title: doc.title,
          excerpt: doc.excerpt,
          category: doc.category,
          publishDate: new Date(doc.publishDate),
          updatedAt: new Date(doc._updatedAt ?? doc.publishDate),
          author: doc.author,
          coverImage: doc.coverImage,
          relatedWorkSlug: doc.relatedWorkSlug,
          bodyHtml,
          readTimeMinutes: estimateReadTime(bodyHtml),
          featured: doc.featured ?? false,
          seo: doc.seo,
        },
      } as CollectionMap[C];
    }
    case "partners":
      return {
        data: {
          slug,
          lang: doc.lang,
          name: doc.name,
          description: doc.description,
          location: doc.location,
          coverImage: doc.coverImage,
          relatedWorkSlug: doc.relatedWorkSlug,
          seo: doc.seo,
        },
      } as CollectionMap[C];
    default:
      throw new Error(`Unknown collection: ${collection}`);
  }
}

export async function getEntriesByLang<C extends CollectionKey>(
  collection: C,
  lang: Lang,
): Promise<CollectionMap[C][]> {
  const docs = await sanityClient.fetch(`*[_type == $type && lang == $lang]`, {
    type: collection,
    lang,
  });
  return docs.map((doc: any) => mapEntry(collection, doc));
}

export async function getEntryBySlugAndLang<C extends CollectionKey>(
  collection: C,
  slug: string,
  lang: Lang,
): Promise<CollectionMap[C] | undefined> {
  const doc = await sanityClient.fetch(
    `*[_type == $type && lang == $lang && slug.current == $slug][0]`,
    { type: collection, lang, slug },
  );
  return doc ? mapEntry(collection, doc) : undefined;
}

export async function getFeatured<C extends CollectionKey>(
  collection: C,
  lang: Lang,
  limit?: number,
): Promise<CollectionMap[C][]> {
  const entries = await getEntriesByLang(collection, lang);
  const featured = entries.filter((entry) => (entry.data as { featured?: boolean }).featured);
  return limit ? featured.slice(0, limit) : featured;
}

export function sortByDateDesc<T extends { data: { publishDate?: Date; startDate?: Date } }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    const dateA = (a.data.publishDate ?? a.data.startDate ?? new Date(0)).valueOf();
    const dateB = (b.data.publishDate ?? b.data.startDate ?? new Date(0)).valueOf();
    return dateB - dateA;
  });
}
