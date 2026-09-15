/**
 * Mirrors `JournalCategory` / `JournalFormat` from `src/lib/content.ts` and
 * the `journal` document schema in WEBLACK-STUDIO — reproduced rather than
 * imported to avoid this Node CLI tool pulling in `src/lib/content.ts`'s
 * Vite-only `import.meta.env` Sanity client as a side effect. Keep these
 * lists in sync by hand if either source changes (same convention already
 * used in WEBLACK-STUDIO's own schema files, which say "reproduced exactly
 * from the live schema").
 */
export const JOURNAL_CATEGORIES = [
  "news",
  "fashion",
  "designers",
  "industry-perspectives",
  "culture",
  "interviews",
  "insights",
  "reports",
  "projects",
] as const;
export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

export const JOURNAL_FORMATS = ["news", "analysis", "portrait", "interview", "report", "opinion", "project-partnership"] as const;
export type JournalFormat = (typeof JOURNAL_FORMATS)[number];

export type JournalLang = "fr" | "en";

/**
 * Provenance for one atomic extracted fact: the verbatim source excerpt that
 * grounds it, in the SOURCE's own language, plus a working French
 * translation when the source is not French. This is what lets a fact be
 * confirmed against the real source text — in code, with zero extra model
 * calls — BEFORE it is ever handed to the writer (see generation/verifiedFacts.ts).
 */
export interface FactEvidence {
  /** The fact itself, stated in the SOURCE's language so it can be checked against the source without a translation step. */
  fact: string;
  category: "person" | "brand" | "organization" | "location" | "date" | "number" | "event" | "quote" | "general";
  /** "critical" for anything that would mislead a reader if wrong (figures, dates, quotes, roles, causal links) — those may only ever be written up with cautious, attributed phrasing from a single source. */
  importance: "critical" | "significant" | "minor";
  /** Verbatim excerpt from the source, in the source's own language. The only thing ever treated as proof. */
  evidenceQuote: string;
  /** Working French translation of evidenceQuote, for the writer's convenience only — never proof. Empty when the source is already French. */
  evidenceTranslation: string;
}

/** Structured facts pulled from the source material — Phase 7. Every field defaults to empty; the model is instructed to never fill a field it cannot ground in the source text. */
export interface ExtractedFacts {
  people: string[];
  brands: string[];
  organizations: string[];
  locations: string[];
  dates: string[];
  numbers: string[];
  events: string[];
  claims: string[];
  keyFacts: string[];
  /** Direct quotes found verbatim in the source, with enough context to verify against it. Empty if none were present. */
  quotes: { text: string; attributedTo?: string }[];
  /** Real language of the source text ("en", "fr", ...) — reported by the extraction step, which is already reading the text. */
  sourceLanguage: string;
  /** One entry per atomic fact, each carrying the verbatim excerpt that proves it. A fact with no verbatim excerpt is omitted here, and therefore never reaches the writer. */
  factEvidence: FactEvidence[];
}

/** Verification outcome for one fact or claim. Declared here rather than in validation/claimRegistry.ts so both the pre-writing fact set and the post-writing fact check can share it without importing each other at runtime. */
export type VerificationStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "CONTRADICTED";

export interface VerifiedFact {
  fact: string;
  category: FactEvidence["category"];
  status: VerificationStatus;
  evidenceQuote: string;
  evidenceTranslation: string;
}

/** The Evidence Pack: what survived pre-writing verification, and what was dropped before the writer saw it. */
export interface VerifiedFactSet {
  sourceLanguage: string;
  /** Confirmed verbatim in the real source text — the writer may state these plainly. */
  verified: VerifiedFact[];
  /** Confirmed too, but load-bearing enough (figures, dates, quotes, roles, causality) that a single secondary source does not justify asserting them flatly — the writer must attribute and hedge them. */
  partiallyVerified: VerifiedFact[];
  /** Never shown to the writer, in any form. Kept only so a dry-run report can show what was dropped and why. */
  rejected: { fact: string; status: VerificationStatus }[];
}

/**
 * Les huit territoires éditoriaux du Journal WEBLACK. Un sujet qui n'entre
 * dans aucun d'eux n'a pas sa place, si populaire soit-il — d'où la valeur
 * explicite OUT_OF_TERRITORY plutôt qu'un rattachement forcé au territoire
 * le moins invraisemblable.
 */
export const WEBLACK_TERRITORIES = [
  "FASHION_LUXURY",
  "ART_CULTURE",
  "DESIGN_ARCHITECTURE",
  "CREATIVE_INDUSTRIES",
  "TALENTS",
  "CULTURAL_CREATIVE_BUSINESS",
  "CULTURAL_SCENES_EVENTS",
  "CULTURAL_AGENDA",
  "OUT_OF_TERRITORY",
] as const;
export type WeblackTerritory = (typeof WEBLACK_TERRITORIES)[number];

/** Phase 6 editorial analysis output. */
export interface EditorialAnalysis {
  /** Lequel des huit territoires le sujet occupe réellement. */
  territory: WeblackTerritory;
  /** La question forte à laquelle le sujet répond. Vide s'il n'en satisfait aucune — ce qui vaut rejet. */
  editorialValue: string;
  relevance: number; // 0-100
  /** Importance CULTURELLE, pas importance économique ou médiatique. */
  importance: number; // 0-100
  novelty: number; // 0-100
  reliability: number; // 0-100
  readerInterest: number; // 0-100
  /** Ce que le sujet apporte à la création elle-même, au-delà de son actualité. */
  creativeInterest: number; // 0-100
  /** De quoi tenir un article, ou seulement de quoi recopier un communiqué. */
  analyticalPotential: number; // 0-100
  /** Sujet déjà traité partout, ou angle réellement neuf. */
  originality: number; // 0-100
  seoPotential: number; // 0-100
  category: JournalCategory;
  format: JournalFormat | undefined;
  angle: string;
  priority: "low" | "medium" | "high";
  score: number; // 0-100 overall
  reasoning: string;
}

/** A single Portable Text block ready to write into `journal.body`. Only the block/image shapes actually declared in the schema. */
export type PortableBlock =
  | {
      _type: "block";
      _key: string;
      style: "normal" | "h2" | "h3" | "blockquote";
      children: { _type: "span"; _key: string; text: string; marks: string[] }[];
      markDefs: [];
    }
  | {
      _type: "image";
      _key: string;
      asset: { _type: "reference"; _ref: string };
      alt: string;
      caption?: string;
    };

/**
 * Everything needed to write a `journal` document — field names match the
 * real schema exactly (see WEBLACK-STUDIO/schemaTypes/documents/journal.ts).
 * No `status`/`draft` field exists in the schema; draft vs. published is
 * handled by Sanity's native `drafts.<id>` document-id convention, not a
 * schema field.
 */
export interface GeneratedArticle {
  lang: JournalLang;
  title: string;
  slug: string;
  excerpt: string;
  category: JournalCategory;
  format?: JournalFormat;
  publishDate: string; // YYYY-MM-DD
  author: string;
  coverImage?: { url: string; alt: string; width: number; height: number; credit?: { photographer: string; photographerUrl?: string } };
  body: PortableBlock[];
  seo?: { title: string; description: string };
  source: { name: string; url: string };
  editorialScore: number;
  confidenceScore: number;
}
