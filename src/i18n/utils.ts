import { ui, defaultLang, languages, type Lang, type UiKey } from "./ui";
import { ENABLED_LOCALE_CODES } from "./locales";

export { languages, defaultLang };
export type { Lang, UiKey };

export function getLangFromUrl(url: URL): Lang {
  const [, maybeLang] = url.pathname.split("/");
  if (maybeLang in languages) return maybeLang as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: UiKey): string {
    return ui[lang][key] ?? ui[defaultLang][key];
  };
}

/**
 * All *enabled* locales other than the given one, in registry order. Used
 * by the language switcher to list every alternate version of the current
 * page — replaces the old two-way-only `otherLang()`.
 */
export function otherEnabledLocales(lang: Lang): Lang[] {
  return ENABLED_LOCALE_CODES.filter((code) => code !== lang);
}

/**
 * Swaps the locale segment of a path (e.g. /poles/talents -> /en/poles/talents,
 * /en/poles/talents -> /poles/talents). Used as the *default* resolution for
 * the language switcher and hreflang when a route doesn't supply an explicit
 * `translations` map — correct for any page whose slug is identical across
 * locales (true for every static page and most content today).
 */
export function switchLocalePath(pathname: string, targetLang: Lang): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] in languages) segments.shift();
  const prefix = targetLang === defaultLang ? "" : `/${targetLang}`;
  const rest = segments.length ? `/${segments.join("/")}` : "";
  return `${prefix}${rest}/` || "/";
}

export function localizedPath(lang: Lang, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return lang === defaultLang ? clean : `/${lang}${clean}`;
}

/**
 * Explicit, per-locale map of "this exact content's URL in that locale" —
 * supplied by a route only when the naive same-slug swap above doesn't hold
 * (e.g. a Journal article whose FR and EN slugs differ, or one that isn't
 * published in every locale). A locale absent from this map has no known
 * translation: never fabricate one.
 *
 * The distinction that matters to `resolveTranslations` below:
 * - `undefined` (the prop simply not passed) — this route never checks
 *   per-locale availability; assume the naive same-slug swap is valid for
 *   every enabled locale. Correct default for static pages.
 * - `{}` (an explicit, empty map) — this route DID check, and found no
 *   translation anywhere. Every locale is reported unavailable. This is
 *   NOT the same as `undefined` — passing `undefined` here by mistake for
 *   a page that has no translation silently resurrects the naive swap and
 *   produces exactly the broken hreflang this mechanism exists to prevent
 *   (a real regression caught once already — see journal/[slug].astro).
 *   Any route that computes translations must always pass a map, even an
 *   empty one, never `undefined`, once it has actually looked.
 */
export type TranslationMap = Partial<Record<Lang, string>>;

export interface ResolvedTranslation {
  lang: Lang;
  /** Locale-prefixed relative path (e.g. "/en/journal/foo/"), ready to use as an href. */
  path: string;
}

/**
 * Resolves this page's known translations to a path per locale, or omits a
 * locale entirely when no translation is known.
 * - No `translations` map supplied at all: naive slug-swap for every
 *   *enabled* locale (today's default behavior, unchanged) — safe only
 *   because it's limited to locales with full page parity.
 * - `translations` supplied: authoritative and trusted for ANY locale in
 *   the map, regardless of that locale's global `enabled` flag. This is
 *   what lets a single page (e.g. the homepage) opt in to a not-yet-`enabled`
 *   locale like nb/zh without that locale's `enabled: false` suppressing it
 *   — and, symmetrically, without flipping `enabled` globally and breaking
 *   every other page's naive-swap fallback for a locale that doesn't have
 *   pages yet. A locale missing from the map is reported as unavailable,
 *   full stop, never guessed.
 */
export function resolveTranslations(
  lang: Lang,
  pathname: string,
  translations?: TranslationMap,
): ResolvedTranslation[] {
  if (translations) {
    return (Object.keys(translations) as Lang[])
      .filter((targetLang) => targetLang !== lang)
      .map((targetLang): ResolvedTranslation => ({ lang: targetLang, path: translations[targetLang]! }));
  }
  return otherEnabledLocales(lang).map((targetLang): ResolvedTranslation => ({
    lang: targetLang,
    path: switchLocalePath(pathname, targetLang),
  }));
}
