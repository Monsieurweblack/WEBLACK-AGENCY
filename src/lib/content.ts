import { createClient, type SanityClient } from "@sanity/client";
import { toHTML } from "@portabletext/to-html";
import type { PortableTextBlock } from "@portabletext/types";
import type { Lang } from "../i18n/utils";
import { toPublicEvent, startsAfterPublication, isRunningNow, type AgendaEventData } from "./agenda-public";

export const sanityClient: SanityClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID,
  dataset: import.meta.env.SANITY_DATASET,
  apiVersion: "2025-01-01",
  // Content is read exactly once per build (SSG, no runtime requests), so there is
  // no request volume to justify the CDN's ~30-60s propagation lag. Reading the
  // live API instead guarantees a build always sees the latest published content.
  useCdn: false,
  // Without this, a wildcard query like `*[_type == "journal"]` returns BOTH the
  // published document and any `drafts.<id>` version — confirmed empirically by
  // creating a real draft and querying it with the exact shape used below. This
  // means an editorial-engine draft (deliberately unpublished, pending human
  // review) would otherwise render on the live site at the next build. Forcing
  // the "published" perspective excludes every `drafts.*` document from every
  // query this client makes, site-wide, in one place instead of patching each
  // GROQ string individually.
  perspective: "published",
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

/**
 * Editorial taxonomy: ACTUALITÉS / MODE / CRÉATEURS / INDUSTRIE / CULTURE /
 * INTERVIEWS / ANALYSES / REPORTAGES — a set the site can realistically
 * sustain rather than a speculative list of categories with nothing behind
 * them. "projects" is kept as a 9th, legacy category: it already holds a
 * real published article and renaming or migrating it requires a Sanity
 * write (out of scope here — see the editorial audit report).
 *
 * Two categories that existed in code with zero published content
 * ("fashion-weeks", "talent-stories") were removed for this reason; they
 * can come back the day there is a real, recurring reason to split them
 * out from "fashion" / "interviews" again.
 */
export type JournalCategory =
  | "news"
  | "fashion"
  | "designers"
  | "industry-perspectives"
  | "culture"
  | "interviews"
  | "insights"
  | "reports"
  | "projects";

/**
 * Editorial treatment, distinct from JournalCategory (the subject). No
 * document in Sanity has this field yet — it doesn't exist in the Studio
 * schema, which lives outside this repo and wasn't touched here. This type
 * plus the optional `format` field below only make the front-end ready to
 * read and display it the day the field is added on the Sanity side and
 * populated; until then it's always undefined and nothing renders.
 */
export type JournalFormat =
  | "news"
  | "analysis"
  | "portrait"
  | "interview"
  | "report"
  | "opinion"
  | "project-partnership";

/**
 * Canonical editorial ordering for category tabs. Pages derive the actual
 * tab set from published articles (never show a tab with nothing behind
 * it) but sort it against this order for a stable, intentional sequence.
 */
export const JOURNAL_CATEGORY_ORDER: JournalCategory[] = [
  "news",
  "fashion",
  "designers",
  "industry-perspectives",
  "culture",
  "interviews",
  "insights",
  "reports",
  "projects",
];

export type TalentStatus = "draft" | "active" | "archived";

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
  /** Undefined on documents saved before this field existed — never treated as "active". */
  status?: TalentStatus;
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
  /** Optional manual display order — undefined on every document today; callers fall back to date-sort. */
  order?: number;
  seo?: Seo;
}

/**
 * Moderated comments, added directly in Sanity by an editor after review —
 * there is no public submission pipeline into this field (see the comment
 * form's mailto: flow below). No document has this field in the Studio
 * schema yet; like `format`, it's additive and simply reads as empty until
 * populated.
 */
export interface JournalComment {
  name: string;
  text: string;
  date: string;
}

export interface JournalData {
  slug: string;
  lang: Lang;
  title: string;
  excerpt: string;
  category: JournalCategory;
  format?: JournalFormat;
  publishDate: Date;
  updatedAt: Date;
  author?: string;
  coverImage: EntryImage;
  relatedWorkSlug?: string;
  bodyHtml: string;
  comments?: JournalComment[];
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
 * A real, uploaded Sanity image asset (the `editorialImage` object type
 * used by the CMS-managed types below), as opposed to `EntryImage`
 * (`externalImage` — a plain URL string, still used by journal/work/
 * talent/partners and left untouched).
 */
export interface EditorialImageData {
  url: string;
  alt: string;
  caption?: string;
  /** Parsed from the same asset ref as `url` — always resolves together with it for a real Sanity image asset. */
  width: number;
  height: number;
}

/**
 * Un logo ne se rogne pas ; une photographie se rogne pour remplir son
 * cadre sans en souffrir. Plutôt qu'une liste de cas particuliers par
 * projet, l'image décide elle-même de son cadrage à partir de ses
 * proportions réelles — même seuil partout où ce choix se pose (fiche
 * projet, composition éditoriale à 1-2 projets, carte CardWork).
 */
export function imageFit(image: { width: number; height: number }): "cover" | "contain" {
  return image.width / image.height >= 1.5 ? "cover" : "contain";
}

function mapEditorialImage(raw: any): EditorialImageData | undefined {
  const ref: string | undefined = raw?.asset?._ref;
  const url = sanityImageUrl(ref);
  const dims = ref?.match(/^image-[a-f0-9]+-(\d+)x(\d+)-\w+$/);
  if (!url || !dims) return undefined;
  return {
    url,
    alt: raw.alt ?? "",
    caption: raw.caption,
    width: Number(dims[1]),
    height: Number(dims[2]),
  };
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
          status: doc.status,
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
          order: doc.order,
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
          format: doc.format,
          publishDate: new Date(doc.publishDate),
          updatedAt: new Date(doc._updatedAt ?? doc.publishDate),
          author: doc.author,
          coverImage: doc.coverImage,
          relatedWorkSlug: doc.relatedWorkSlug,
          bodyHtml,
          comments: doc.comments,
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
  const docs = await sanityClient.fetch(
    `*[_type == $type && lang == $lang]{
      ...,
      "relatedWorkSlug": coalesce(relatedWork->slug.current, relatedWorkSlug),
      "relatedWorkSlugs": coalesce(relatedWorks[]->slug.current, relatedWorkSlugs)
    }`,
    { type: collection, lang },
  );
  return docs.map((doc: any) => mapEntry(collection, doc));
}

export async function getEntryBySlugAndLang<C extends CollectionKey>(
  collection: C,
  slug: string,
  lang: Lang,
): Promise<CollectionMap[C] | undefined> {
  const doc = await sanityClient.fetch(
    `*[_type == $type && lang == $lang && slug.current == $slug][0]{
      ...,
      "relatedWorkSlug": coalesce(relatedWork->slug.current, relatedWorkSlug),
      "relatedWorkSlugs": coalesce(relatedWorks[]->slug.current, relatedWorkSlugs)
    }`,
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

// ---------------------------------------------------------------------------
// CMS content (Phase 4) — homepage, site settings, expertise, team, partner
// logos, live. Each of these is genuinely editable from Sanity Studio
// (WEBLACK-STUDIO) with no code change required; nothing here is invented —
// every field is either read as-is or, for the two singletons below, was
// migrated verbatim from this repo's own previously-hardcoded copy.
// ---------------------------------------------------------------------------

function localized(lang: Lang, fr: string | undefined, en: string | undefined): string {
  return (lang === "en" ? en : fr) ?? fr ?? en ?? "";
}

// --- Site Settings (singleton, _id "siteSettings") -------------------------

export interface SiteSettingsData {
  siteName: string;
  baseline?: string;
  logo?: EditorialImageData;
  symbol?: EditorialImageData;
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: EditorialImageData;
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  youtubeUrl?: string;
  whatsappUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  publicLocation?: string;
  footerText?: string;
}

export async function getSiteSettings(lang: Lang): Promise<SiteSettingsData | undefined> {
  const doc = await sanityClient.fetch(`*[_id == "siteSettings"][0]`);
  if (!doc) return undefined;
  return {
    siteName: doc.siteName,
    baseline: localized(lang, doc.baselineFr, doc.baselineEn) || undefined,
    logo: mapEditorialImage(doc.logo),
    symbol: mapEditorialImage(doc.symbol),
    seoTitle: localized(lang, doc.seoTitleFr, doc.seoTitleEn) || undefined,
    seoDescription: localized(lang, doc.seoDescriptionFr, doc.seoDescriptionEn) || undefined,
    ogImage: mapEditorialImage(doc.ogImage),
    instagramUrl: doc.instagramUrl,
    facebookUrl: doc.facebookUrl,
    linkedinUrl: doc.linkedinUrl,
    youtubeUrl: doc.youtubeUrl,
    whatsappUrl: doc.whatsappUrl,
    contactEmail: doc.contactEmail,
    contactPhone: doc.contactPhone,
    publicLocation: doc.publicLocation,
    footerText: localized(lang, doc.footerTextFr, doc.footerTextEn) || undefined,
  };
}

// --- Homepage (singleton, _id "homepage") -----------------------------------

export interface HomepageHero {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  image?: EditorialImageData;
  ctaPrimaryLabel?: string;
  ctaPrimaryUrl?: string;
  ctaSecondaryLabel?: string;
  ctaSecondaryUrl?: string;
}

export interface HomepageTextSection {
  title?: string;
  intro?: string;
}

export interface HomepageData {
  hero: HomepageHero;
  manifesto: { text?: string };
  journalSection: HomepageTextSection & { articleCount?: number; selectedSlugs: string[]; useFeaturedFallback: boolean };
  expertisesSection: HomepageTextSection;
  projectsSection: HomepageTextSection & { projectCount?: number; selectedSlugs: string[]; useFeaturedFallback: boolean };
  talentSection: HomepageTextSection & { ctaLabel?: string };
  partnersSection: HomepageTextSection & { logoCount?: number; selectedIds: string[] };
  teamSection: HomepageTextSection & { selectedIds: string[] };
  contactSection: HomepageTextSection & { text?: string; ctaLabel?: string };
}

/**
 * Manual-selection reference arrays are dereferenced to their slug/_id only
 * (one GROQ query, no follow-up fetches) — the caller resolves them against
 * entries it already fetches via getEntriesByLang/getFeatured, so this
 * never doubles up on requests.
 */
export async function getHomepage(lang: Lang): Promise<HomepageData | undefined> {
  const doc = await sanityClient.fetch(
    `*[_id == "homepage"][0]{
      hero, manifesto, expertisesSection,
      journalSection{..., "selectedSlugs": selectedArticles[]->slug.current},
      projectsSection{..., "selectedSlugs": selectedProjects[]->slug.current},
      talentSection,
      partnersSection{..., "selectedIds": selectedPartners[]._ref},
      teamSection{..., "selectedIds": selectedMembers[]._ref}
    }`,
  );
  if (!doc) return undefined;

  const text = (section: any): HomepageTextSection => ({
    title: localized(lang, section?.titleFr, section?.titleEn) || undefined,
    intro: localized(lang, section?.introFr, section?.introEn) || undefined,
  });

  return {
    hero: {
      eyebrow: localized(lang, doc.hero?.eyebrowFr, doc.hero?.eyebrowEn) || undefined,
      title: localized(lang, doc.hero?.titleFr, doc.hero?.titleEn) || undefined,
      subtitle: localized(lang, doc.hero?.subtitleFr, doc.hero?.subtitleEn) || undefined,
      image: mapEditorialImage(doc.hero?.image),
      ctaPrimaryLabel: localized(lang, doc.hero?.ctaPrimaryLabelFr, doc.hero?.ctaPrimaryLabelEn) || undefined,
      ctaPrimaryUrl: doc.hero?.ctaPrimaryUrl,
      ctaSecondaryLabel: localized(lang, doc.hero?.ctaSecondaryLabelFr, doc.hero?.ctaSecondaryLabelEn) || undefined,
      ctaSecondaryUrl: doc.hero?.ctaSecondaryUrl,
    },
    manifesto: { text: localized(lang, doc.manifesto?.textFr, doc.manifesto?.textEn) || undefined },
    journalSection: {
      ...text(doc.journalSection),
      articleCount: doc.journalSection?.articleCount,
      selectedSlugs: (doc.journalSection?.selectedSlugs ?? []).filter(Boolean),
      useFeaturedFallback: doc.journalSection?.useFeaturedFallback ?? true,
    },
    expertisesSection: text(doc.expertisesSection),
    projectsSection: {
      ...text(doc.projectsSection),
      projectCount: doc.projectsSection?.projectCount,
      selectedSlugs: (doc.projectsSection?.selectedSlugs ?? []).filter(Boolean),
      useFeaturedFallback: doc.projectsSection?.useFeaturedFallback ?? true,
    },
    talentSection: {
      ...text(doc.talentSection),
      ctaLabel: localized(lang, doc.talentSection?.ctaLabelFr, doc.talentSection?.ctaLabelEn) || undefined,
    },
    partnersSection: {
      ...text(doc.partnersSection),
      logoCount: doc.partnersSection?.logoCount,
      selectedIds: (doc.partnersSection?.selectedIds ?? []).filter(Boolean),
    },
    teamSection: { ...text(doc.teamSection), selectedIds: (doc.teamSection?.selectedIds ?? []).filter(Boolean) },
    contactSection: {
      ...text(doc.contactSection),
      text: localized(lang, doc.contactSection?.textFr, doc.contactSection?.textEn) || undefined,
      ctaLabel: localized(lang, doc.contactSection?.ctaLabelFr, doc.contactSection?.ctaLabelEn) || undefined,
    },
  };
}

// --- Expertise ---------------------------------------------------------------

export interface ExpertiseData {
  slug: string;
  title: string;
  tagline?: string;
  description?: string;
  image?: EditorialImageData;
  ctaLabel?: string;
  order: number;
}

export async function getExpertises(lang: Lang): Promise<ExpertiseData[]> {
  const docs = await sanityClient.fetch(
    `*[_type == "expertise" && active == true] | order(order asc)`,
  );
  return docs.map((doc: any) => ({
    slug: doc.slug?.current,
    title: localized(lang, doc.titleFr, doc.titleEn),
    tagline: localized(lang, doc.taglineFr, doc.taglineEn) || undefined,
    description: localized(lang, doc.descriptionFr, doc.descriptionEn) || undefined,
    image: mapEditorialImage(doc.image),
    ctaLabel: localized(lang, doc.ctaLabelFr, doc.ctaLabelEn) || undefined,
    order: doc.order,
  }));
}

// --- Team members --------------------------------------------------------------

export interface TeamMemberData {
  id: string;
  name: string;
  role?: string;
  photo?: EditorialImageData;
  bioHtml?: string;
  quote?: string;
  quoteAttribution?: string;
  gallery: EditorialImageData[];
  linkedinUrl?: string;
  instagramUrl?: string;
  portfolioUrl?: string;
  order?: number;
  featured: boolean;
}

export async function getTeamMembers(lang: Lang): Promise<TeamMemberData[]> {
  const docs = await sanityClient.fetch(
    `*[_type == "teamMember" && active == true] | order(order asc)`,
  );
  return docs.map((doc: any) => ({
    id: doc._id,
    name: doc.name,
    role: localized(lang, doc.roleFr, doc.roleEn) || undefined,
    photo: mapEditorialImage(doc.photo),
    bioHtml: toHtmlSafe(lang === "en" ? doc.bioEn : doc.bioFr) || undefined,
    quote: localized(lang, doc.quoteFr, doc.quoteEn) || undefined,
    quoteAttribution: doc.quoteAttribution,
    gallery: (doc.gallery ?? []).map(mapEditorialImage).filter(Boolean),
    linkedinUrl: doc.linkedinUrl,
    instagramUrl: doc.instagramUrl,
    portfolioUrl: doc.portfolioUrl,
    order: doc.order,
    featured: doc.featured ?? false,
  }));
}

// --- Partner (logo grid) — distinct from the existing `partners` type ------

export type PartnerCategory = "event" | "brand" | "institution" | "media" | "fashion" | "culture" | "other";
export type PartnerStatus = "current" | "past";

export interface PartnerLogoData {
  id: string;
  name: string;
  logo: EditorialImageData;
  website?: string;
  category: PartnerCategory;
  status: PartnerStatus;
  description?: string;
  year?: number;
  order?: number;
  featured: boolean;
}

export async function getPartnerLogos(lang: Lang): Promise<PartnerLogoData[]> {
  const docs = await sanityClient.fetch(
    `*[_type == "partner" && active == true] | order(order asc)`,
  );
  return docs
    .map((doc: any) => {
      const logo = mapEditorialImage(doc.logo);
      if (!logo) return null;
      const altOverride = localized(lang, doc.altFr, doc.altEn);
      return {
        id: doc._id,
        name: doc.name,
        logo: altOverride ? { ...logo, alt: altOverride } : logo,
        website: doc.website,
        category: doc.category,
        status: doc.status,
        description: localized(lang, doc.descriptionFr, doc.descriptionEn) || undefined,
        year: doc.year,
        order: doc.order,
        featured: doc.featured ?? false,
      };
    })
    .filter((p: PartnerLogoData | null): p is PartnerLogoData => p !== null);
}

// --- Live --------------------------------------------------------------------

export type LiveStatus = "upcoming" | "live" | "replay";

export interface LiveData {
  id: string;
  title: string;
  description?: string;
  eventName?: string;
  date?: string;
  coverImage?: EditorialImageData;
  youtubeUrl?: string;
  youtubeVideoId?: string;
  status: LiveStatus;
  showChat: boolean;
  featured: boolean;
  order?: number;
}

export async function getLiveEvents(lang: Lang): Promise<LiveData[]> {
  const docs = await sanityClient.fetch(`*[_type == "live"] | order(order asc)`);
  return docs.map((doc: any) => ({
    id: doc._id,
    title: localized(lang, doc.titleFr, doc.titleEn),
    description: localized(lang, doc.descriptionFr, doc.descriptionEn) || undefined,
    eventName: doc.eventName,
    date: doc.date,
    coverImage: mapEditorialImage(doc.coverImage),
    youtubeUrl: doc.youtubeUrl,
    youtubeVideoId: doc.youtubeVideoId,
    status: doc.status,
    showChat: doc.showChat ?? false,
    featured: doc.featured ?? false,
    order: doc.order,
  }));
}

/** Picks which live entry to show: an actual "live" one first, else the featured one, else the first by order. Never infers "live" from a URL or date. */
export function getPrimaryLive(entries: LiveData[]): LiveData | undefined {
  return entries.find((e) => e.status === "live") ?? entries.find((e) => e.featured) ?? entries[0];
}

// --- Agenda (type "event", écrit par le moteur éditorial) --------------------

/**
 * La lecture de l'Agenda. La règle qui décide ce qui a le droit d'être
 * annoncé vit dans src/lib/agenda-public.ts, sans dépendance à Sanity ni à
 * Astro : c'est la seule partie du site dont une erreur se verrait dehors,
 * et elle doit pouvoir être vérifiée seule.
 */
export type { AgendaStatus, PublicAgendaStatus, AgendaEventData } from "./agenda-public";
export { agendaFacets } from "./agenda-public";

const AGENDA_PROJECTION = `{
  _id, slug, eventName, eventType, discipline, artistOrCreator, institution,
  startDate, endDate, time, venue, city, country, organizer,
  disciplineEn, countryEn, descriptionFr, descriptionEn, officialUrl, sourceUrls,
  status, verificationStatus, lastVerifiedAt, editorialRelevance
}`;

/** Les événements à annoncer, du plus proche au plus lointain. */
export async function getAgendaEvents(lang: Lang): Promise<AgendaEventData[]> {
  const docs = await sanityClient.fetch(`*[_type == "event"] | order(startDate asc) ${AGENDA_PROJECTION}`);
  const today = new Date().toISOString().slice(0, 10);

  const events: AgendaEventData[] = [];
  for (const doc of docs as any[]) {
    const event = toPublicEvent(doc);
    if (!event || !startsAfterPublication(event, today)) continue;
    // La discipline sert d'étiquette ET de filtre : affichée dans une langue
    // et filtrée dans l'autre, une même discipline compterait deux fois.
    const description = localized(lang, doc.descriptionFr, doc.descriptionEn);
    const discipline = localized(lang, doc.discipline, doc.disciplineEn);
    const country = localized(lang, doc.country, doc.countryEn);
    events.push({
      ...event,
      discipline: discipline || undefined,
      country: country || undefined,
      description: description || undefined,
    });
  }
  return events;
}


/**
 * Ce qui se tient en ce moment — la matière de WEBLACK NOW.
 *
 * Même porte d'entrée que l'Agenda : vérifié sur la page officielle,
 * complet, en territoire. Seule la fenêtre temporelle change. Les deux
 * listes sont disjointes : un événement est soit en cours, soit à venir.
 */
export async function getOngoingEvents(lang: Lang): Promise<AgendaEventData[]> {
  const docs = await sanityClient.fetch(`*[_type == "event"] | order(startDate desc) ${AGENDA_PROJECTION}`);
  const today = new Date().toISOString().slice(0, 10);

  const events: AgendaEventData[] = [];
  for (const doc of docs as any[]) {
    const event = toPublicEvent(doc);
    if (!event || !isRunningNow(event, today)) continue;
    const description = localized(lang, doc.descriptionFr, doc.descriptionEn);
    const discipline = localized(lang, doc.discipline, doc.disciplineEn);
    const country = localized(lang, doc.country, doc.countryEn);
    events.push({ ...event, discipline: discipline || undefined, country: country || undefined, description: description || undefined });
  }
  return events;
}

/** Un événement précis, pour sa page propre. Même filtre que la liste : ce qui ne s'annonce pas n'a pas de page. */
export async function getAgendaEvent(slug: string, lang: Lang): Promise<AgendaEventData | undefined> {
  const events = await getAgendaEvents(lang);
  return events.find((event) => event.slug === slug);
}

// --- WEBLACK NOW — radar culturel curaté -----------------------------------

export interface NowSignalData {
  id: string;
  title: string;
  territory: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  /** Absent pour un signal sans date propre (une nomination, par exemple) — jamais déduite. */
  date?: string;
}

/**
 * Second filtre, indépendant de celui du moteur — même philosophie que
 * src/lib/agenda-public.ts : « le site ne doit pas dépendre de la prudence
 * de qui a écrit le document ». Un signal `nowSignal` plus vieux que la
 * fenêtre d'affichage (30 jours — même seuil que editorial-engine/now/
 * freshness.ts HISTORICAL, reproduit ici plutôt qu'importé : ce module Node
 * ne doit jamais entrer dans le bundle Vite, voir la note en tête de ce
 * fichier sur sanityClient) ne s'affiche plus, même s'il reste dans Sanity.
 */
function isNowSignalFresh(discoveredAt: string | undefined, eventDate: string | undefined, now = new Date()): boolean {
  const reference = eventDate || discoveredAt;
  if (!reference) return false;
  const date = new Date(reference);
  if (Number.isNaN(date.getTime())) return false;
  const ageDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= 30;
}

/**
 * Les signaux éditoriaux WEBLACK NOW ("editorial-signal" — voir
 * editorial-engine/now/types.ts) réellement publiés dans Sanity.
 *
 * Ne renvoie jamais d'erreur si le type `nowSignal` n'existe pas encore
 * dans le dataset (schéma pas encore déployé) : une requête GROQ sur un
 * `_type` inconnu renvoie simplement un tableau
 * vide, comme n'importe quel filtre qui ne trouve rien. WeblackNow.astro
 * continue alors de fonctionner sur les seuls événements Agenda ONGOING,
 * exactement comme avant ce chantier.
 */
export async function getNowSignals(lang: Lang): Promise<NowSignalData[]> {
  const docs = await sanityClient.fetch(
    `*[_type == "nowSignal"] | order(discoveredAt desc){
      engineId, title, titleEn, territory, summary, summaryEn,
      sourceName, sourceUrl, discoveredAt, eventDate
    }`,
  );
  const signals: NowSignalData[] = [];
  for (const doc of docs as any[]) {
    if (!doc.engineId || !doc.title || !doc.territory || !doc.sourceUrl) continue;
    if (!isNowSignalFresh(doc.discoveredAt, doc.eventDate)) continue;
    signals.push({
      id: doc.engineId,
      title: localized(lang, doc.title, doc.titleEn) || doc.title,
      territory: doc.territory,
      summary: localized(lang, doc.summary, doc.summaryEn) || doc.summary,
      sourceName: doc.sourceName ?? "",
      sourceUrl: doc.sourceUrl,
      date: doc.eventDate || undefined,
    });
  }
  return signals;
}
