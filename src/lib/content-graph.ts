/**
 * WEBLACK Content Graph — V1
 *
 * A typed, logical relation layer over the two relation fields that already
 * exist in Sanity (`relatedWorkSlug`, `relatedWorkSlugs`). This module does
 * NOT migrate, rename, or add any Sanity field — it only reads the same data
 * `src/lib/content.ts` already reads, and exposes it through typed helpers
 * instead of the ad-hoc `.filter()` lookups currently duplicated across
 * JournalDetail.astro, WorkDetail.astro and partners.astro.
 *
 * Scope of this V1 (see docs/content-graph.md for the full rationale):
 *  - RELATED_PROJECT, COVERS_PROJECT, PARTNER_OF are real, backed by data.
 *  - RELATED_TALENT, RELATED_SERVICE, RELATED_EVENT are registered but
 *    dormant: no Sanity field and, for Service/Event, no content type exists
 *    to target. They exist here purely as documented reservations for future
 *    work — never treat them as functional until a real field/entity backs
 *    them.
 *  - CLIENT and SPONSOR are deliberately NOT modeled: `work.client` is free
 *    text, not a reference to any entity. Guessing a match against the
 *    `partners` collection would be exactly the kind of inference this
 *    project's Content Integrity discipline forbids ("ne devine jamais").
 *
 * All resolution happens within a single language — a relation always
 * targets content in the same `lang` as its source, matching how the site's
 * routes are built (`localizedPath(lang, ...)`). Turning a ContentRef into a
 * URL, or finding its counterpart in another language, is deliberately left
 * to the existing i18n utilities (`src/i18n/utils.ts`) rather than
 * duplicated here.
 */

import type { Lang } from "../i18n/utils";
import { defaultLocale } from "../i18n/locales.ts";
import type { JournalEntry, PartnerEntry, WorkEntry } from "./content";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * The content types that actually exist in this project. "service", "event"
 * and "organization" are intentionally absent — see the module docblock.
 */
export type GraphEntityType = "work" | "journal" | "partners" | "talent";

// ---------------------------------------------------------------------------
// Stable identity (contentId)
// ---------------------------------------------------------------------------

/**
 * A locale-independent identifier: `"{type}:{canonicalSlug}"`. Sanity itself
 * has no such field — the FR and EN documents for "the same" piece of
 * content are unrelated documents with unrelated `_id`s. In the common case
 * (identical slug in both languages, true for every `work` entry and most
 * `journal` entries today) the contentId falls out of the slug for free. The
 * one known exception is covered by CONTENT_ID_ALIASES below.
 */
export type ContentId = string;

export interface ContentIdAlias {
  type: GraphEntityType;
  /** Slug in each locale where it's known to differ from the canonical form. Partial by design — an alias only needs entries for the locales it actually covers. */
  slugs: Partial<Record<Lang, string>>;
}

/**
 * Hand-verified exceptions where a locale's slug differs from the default
 * locale's for what is the same real-world content. This table is NEVER
 * inferred automatically — every entry is a deliberate human decision,
 * re-verified against the live Sanity data before being added (see
 * docs/content-graph.md, "Adding an alias"). Do not add an entry here on a
 * guess. Generic across every locale in the registry (fr/en today, nb/zh
 * the day either has content that needs it) — nothing here is hardcoded to
 * exactly two languages.
 *
 * Verified 2026-08-29 directly against Sanity: both fr/en documents share
 * relatedWorkSlug = "nuit-du-textile-africain-bamako", confirming they cover
 * the same announcement.
 */
export const CONTENT_ID_ALIASES: ContentIdAlias[] = [
  {
    type: "journal",
    slugs: {
      fr: "l-agence-weblack-annonce-un-partenariat-avec-la-nuit-du-textile-africain-une-nouvelle-ambition-pour-la-creation-africaine",
      en: "partenariat-nuit-du-textile-africain",
    },
  },
];

/**
 * Resolves a (type, lang, slug) triple to a stable contentId. The canonical
 * form is anchored on the default locale's slug when the alias declares
 * one, otherwise on whichever slug the alias declares first — so the same
 * contentId is produced regardless of which locale's document you start
 * from.
 */
export function resolveContentId(type: GraphEntityType, lang: Lang, slug: string): ContentId {
  const alias = CONTENT_ID_ALIASES.find((a) => a.type === type && a.slugs[lang] === slug);
  if (alias) {
    const canonicalSlug = alias.slugs[defaultLocale] ?? Object.values(alias.slugs)[0]!;
    return `${type}:${canonicalSlug}`;
  }
  return `${type}:${slug}`;
}

export interface ContentRef {
  type: GraphEntityType;
  contentId: ContentId;
  lang: Lang;
  slug: string;
}

function toContentRef(type: GraphEntityType, lang: Lang, slug: string): ContentRef {
  return { type, contentId: resolveContentId(type, lang, slug), lang, slug };
}

// ---------------------------------------------------------------------------
// Relation types — registry (§17)
// ---------------------------------------------------------------------------

export type RelationTypeCode =
  | "RELATED_PROJECT"
  | "COVERS_PROJECT"
  | "PARTNER_OF"
  | "RELATED_TALENT"
  | "RELATED_SERVICE"
  | "RELATED_EVENT";

export interface RelationTypeDefinition {
  code: RelationTypeCode;
  sourceType: GraphEntityType;
  targetType: GraphEntityType;
  /** false = symmetric (A↔B mean the same thing); true = directed (A→B ≠ B→A). */
  directional: boolean;
  /** Whether the inverse edge is derived automatically without a second declaration. */
  reciprocal: boolean;
  /** false = registered for future use, not backed by any real field or entity yet. */
  active: boolean;
  description: string;
}

export const RELATION_REGISTRY: Record<RelationTypeCode, RelationTypeDefinition> = {
  RELATED_PROJECT: {
    code: "RELATED_PROJECT",
    sourceType: "work",
    targetType: "work",
    directional: false,
    reciprocal: true,
    active: true,
    description: "Backed by work.relatedWorkSlugs. Declaring it on one project surfaces it on both.",
  },
  COVERS_PROJECT: {
    code: "COVERS_PROJECT",
    sourceType: "journal",
    targetType: "work",
    directional: true,
    reciprocal: false,
    active: true,
    description: "Backed by journal.relatedWorkSlug — an article covering a project.",
  },
  PARTNER_OF: {
    code: "PARTNER_OF",
    sourceType: "partners",
    targetType: "work",
    directional: true,
    reciprocal: false,
    active: true,
    description: "Backed by partners.relatedWorkSlug — a partner associated with a project.",
  },
  RELATED_TALENT: {
    code: "RELATED_TALENT",
    sourceType: "work",
    targetType: "talent",
    directional: true,
    reciprocal: false,
    active: false,
    description:
      "Reserved for a future work.relatedTalentSlugs-style field. No such field exists yet and no talent is currently published — do not treat as functional.",
  },
  RELATED_SERVICE: {
    code: "RELATED_SERVICE",
    sourceType: "work",
    targetType: "talent", // placeholder target; no "service" entity type exists yet
    directional: true,
    reciprocal: false,
    active: false,
    description:
      "Reserved for a future Service entity. work.disciplines is free-text tags today, not a reference to any entity — see docs/content-graph.md.",
  },
  RELATED_EVENT: {
    code: "RELATED_EVENT",
    sourceType: "work",
    targetType: "talent", // placeholder target; no "event" entity type exists yet
    directional: true,
    reciprocal: false,
    active: false,
    description:
      "Reserved for a future Event entity. Today's real events (ZE DÉFILÉ, NTA) are modeled as work entries themselves — see docs/content-graph.md.",
  },
};

// ---------------------------------------------------------------------------
// Resolvers — pure functions, no I/O. Callers pass in already-fetched
// same-language entries (Astro pages already call getEntriesByLang once per
// collection); this keeps each page resolving only what it needs (no hidden
// full-graph traversal) and keeps the module trivially testable.
// ---------------------------------------------------------------------------

/** RELATED_PROJECT, both directions — a project need only declare the edge once. */
export function getRelatedProjects(project: WorkEntry, allProjectsSameLang: WorkEntry[]): WorkEntry[] {
  const { slug, relatedWorkSlugs } = project.data;
  const bySlug = new Map<string, WorkEntry>();

  for (const target of relatedWorkSlugs ?? []) {
    if (target === slug) continue; // self-reference — surfaced as a WARNING by Content Integrity, not resolved here
    const match = allProjectsSameLang.find((w) => w.data.slug === target);
    if (match) bySlug.set(match.data.slug, match);
  }

  for (const other of allProjectsSameLang) {
    if (other.data.slug === slug) continue;
    if ((other.data.relatedWorkSlugs ?? []).includes(slug)) bySlug.set(other.data.slug, other);
  }

  return [...bySlug.values()];
}

/** Inverse of COVERS_PROJECT: articles covering a given project. */
export function getCoveringArticles(project: WorkEntry, articlesSameLang: JournalEntry[]): JournalEntry[] {
  return articlesSameLang.filter((a) => a.data.relatedWorkSlug === project.data.slug);
}

/** COVERS_PROJECT direct: the project an article covers, if any. */
export function getProjectForArticle(article: JournalEntry, projectsSameLang: WorkEntry[]): WorkEntry | null {
  if (!article.data.relatedWorkSlug) return null;
  return projectsSameLang.find((w) => w.data.slug === article.data.relatedWorkSlug) ?? null;
}

/** Inverse of PARTNER_OF: partners associated with a given project. */
export function getPartnersOf(project: WorkEntry, partnersSameLang: PartnerEntry[]): PartnerEntry[] {
  return partnersSameLang.filter((p) => p.data.relatedWorkSlug === project.data.slug);
}

/** PARTNER_OF direct: the project a partner is associated with, if any. */
export function getProjectForPartner(partner: PartnerEntry, projectsSameLang: WorkEntry[]): WorkEntry | null {
  if (!partner.data.relatedWorkSlug) return null;
  return projectsSameLang.find((w) => w.data.slug === partner.data.relatedWorkSlug) ?? null;
}

/** Builds a locale-independent reference for any entry — useful for logging/debugging relations across languages. */
export function refFor(type: "work" | "journal" | "partners", entry: WorkEntry | JournalEntry | PartnerEntry): ContentRef {
  return toContentRef(type, entry.data.lang, entry.data.slug);
}
