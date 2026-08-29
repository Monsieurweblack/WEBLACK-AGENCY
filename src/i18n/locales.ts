/**
 * WEBLACK Locale Registry — single source of truth for every supported
 * locale. Nothing else in the codebase should hardcode a locale list, a
 * BCP 47 tag, a native language name, or an `<html lang>` value — it should
 * import from here instead.
 *
 * Target set (per the WEBLACK internationalization brief):
 *   fr-FR, en, nb-NO, zh-CN
 *
 * `enabled: false` means "registered, typed, and safe to reference
 * anywhere — but not yet part of the live site." No route, sitemap entry,
 * hreflang tag, switcher item, or structured-data block should ever be
 * produced for a disabled locale. This mirrors how RELATED_TALENT /
 * RELATED_SERVICE / RELATED_EVENT are handled in src/lib/content-graph.ts:
 * a real, documented reservation, not a working feature.
 *
 * Flipping a locale to `enabled: true` is a deliberate, separate decision —
 * made only once real translated page files and content exist for it (see
 * docs/i18n.md, "Enabling a locale"). Nothing here does that automatically.
 */

export type LocaleCode = "fr" | "en" | "nb" | "zh";

export interface LocaleDefinition {
  code: LocaleCode;
  /** Name of the language, written in that language itself. */
  nativeName: string;
  /**
   * <html lang> value. Deliberately not always identical to `hreflang` —
   * e.g. French is html lang="fr" but hreflang="fr-FR" (hreflang benefits
   * from market specificity; <html lang> is a rendering/accessibility hint
   * kept as general as correctly possible). Chinese is the one locale where
   * script disambiguation ("zh" alone is ambiguous between Simplified and
   * Traditional) makes the fuller tag necessary at the html-lang level too.
   */
  htmlLang: string;
  /** Value used for <link rel="alternate" hreflang="..."> and schema.org inLanguage. */
  hreflang: string;
  /** URL path prefix segment. Empty string for the default locale (no prefix). */
  pathPrefix: string;
  script: "Latin" | "Hans";
  direction: "ltr";
  /** Whether this locale currently has real, published pages. See module docblock. */
  enabled: boolean;
}

export const LOCALES: Record<LocaleCode, LocaleDefinition> = {
  fr: {
    code: "fr",
    nativeName: "Français",
    htmlLang: "fr",
    hreflang: "fr-FR",
    pathPrefix: "",
    script: "Latin",
    direction: "ltr",
    enabled: true,
  },
  en: {
    code: "en",
    nativeName: "English",
    htmlLang: "en",
    hreflang: "en",
    pathPrefix: "en",
    script: "Latin",
    direction: "ltr",
    enabled: true,
  },
  nb: {
    code: "nb",
    nativeName: "Norsk",
    htmlLang: "nb",
    hreflang: "nb-NO",
    pathPrefix: "nb",
    script: "Latin",
    direction: "ltr",
    enabled: false,
  },
  zh: {
    code: "zh",
    nativeName: "中文",
    htmlLang: "zh-CN",
    hreflang: "zh-CN",
    pathPrefix: "zh",
    script: "Hans",
    direction: "ltr",
    enabled: false,
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

export const ENABLED_LOCALE_CODES = LOCALE_CODES.filter((code) => LOCALES[code].enabled);

/** Open Graph og:locale value — the hreflang tag with "-" swapped for "_" (fr-FR -> fr_FR, en -> en). */
export function ogLocaleFor(code: LocaleCode): string {
  return LOCALES[code].hreflang.replace("-", "_");
}

/** BCP 47 tag to hand to Intl.DateTimeFormat / toLocaleDateString / NumberFormat for this locale. */
export function intlTagFor(code: LocaleCode): string {
  return LOCALES[code].hreflang;
}
