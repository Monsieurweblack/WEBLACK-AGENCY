import { ui, defaultLang, languages, type Lang, type UiKey } from "./ui";

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

export function otherLang(lang: Lang): Lang {
  return lang === "fr" ? "en" : "fr";
}

/**
 * Swaps the locale segment of a path (e.g. /poles/talents -> /en/poles/talents,
 * /en/poles/talents -> /poles/talents). Used by the language switcher, which
 * links to the equivalent slug in the other locale rather than that locale's homepage.
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
