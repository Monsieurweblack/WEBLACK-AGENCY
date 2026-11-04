/**
 * WEBLACK Locale Registry — single source of truth for every published
 * locale. Nothing else in the codebase should hardcode a locale list, a
 * BCP 47 tag, a native language name, or an `<html lang>` value — it should
 * import from here instead.
 *
 * WEBLACK is exclusively bilingual: French (default, site root) and English
 * (/en/). Norwegian (nb) and Simplified Chinese (zh) were registered here
 * and briefly served on /nb/, /nb/about/, /zh/ and /zh/about/; they were
 * retired on 2026-11-04 by an explicit product decision. Those four URLs
 * now answer with a 301 at the edge (public/_redirects, migration register
 * in docs/i18n.md). Adding a locale back is a product decision first: real
 * translated pages and content, then an entry here.
 */

export type LocaleCode = "fr" | "en";

export interface LocaleDefinition {
  code: LocaleCode;
  /** Name of the language, written in that language itself. */
  nativeName: string;
  /**
   * <html lang> value. Deliberately not always identical to `hreflang` —
   * French is html lang="fr" but hreflang="fr-FR" (hreflang benefits from
   * market specificity; <html lang> is a rendering/accessibility hint kept
   * as general as correctly possible).
   */
  htmlLang: string;
  /** Value used for <link rel="alternate" hreflang="..."> and schema.org inLanguage. */
  hreflang: string;
  /** URL path prefix segment. Empty string for the default locale (no prefix). */
  pathPrefix: string;
  /** Compact label for the language-switcher trigger button ("FR ▾"). */
  shortLabel: string;
}

export const LOCALES: Record<LocaleCode, LocaleDefinition> = {
  fr: {
    code: "fr",
    nativeName: "Français",
    htmlLang: "fr",
    hreflang: "fr-FR",
    pathPrefix: "",
    shortLabel: "FR",
  },
  en: {
    code: "en",
    nativeName: "English",
    htmlLang: "en",
    hreflang: "en",
    pathPrefix: "en",
    shortLabel: "EN",
  },
};

/**
 * Deliberately typed as the literal "fr", not the wider `LocaleCode` union —
 * this lets `dict[defaultLocale]` narrow to a guaranteed, fully-populated
 * entry everywhere a fallback dictionary is indexed by it (see
 * src/i18n/ui.ts `useTranslations`, src/data/live.ts `localizedText`).
 * Still perfectly assignable anywhere a `LocaleCode` is expected.
 */
export const defaultLocale = "fr" as const;

export const LOCALE_CODES = Object.keys(LOCALES) as LocaleCode[];

/** Open Graph og:locale value — the hreflang tag with "-" swapped for "_" (fr-FR -> fr_FR, en -> en). */
export function ogLocaleFor(code: LocaleCode): string {
  return LOCALES[code].hreflang.replace("-", "_");
}

/** BCP 47 tag to hand to Intl.DateTimeFormat / toLocaleDateString / NumberFormat for this locale. */
export function intlTagFor(code: LocaleCode): string {
  return LOCALES[code].hreflang;
}
