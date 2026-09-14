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

/** Phase 6 editorial analysis output. */
export interface EditorialAnalysis {
  relevance: number; // 0-100
  importance: number; // 0-100
  novelty: number; // 0-100
  reliability: number; // 0-100
  readerInterest: number; // 0-100
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
