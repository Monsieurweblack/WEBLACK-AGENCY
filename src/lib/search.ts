import { getEntriesByLang } from "./content";
import { localizedPath, defaultLang, type Lang } from "../i18n/utils";

export interface SearchEntry {
  title: string;
  description: string;
  url: string;
  type: "page" | "journal" | "work" | "talent";
}

const STATIC_PAGES: Partial<Record<Lang, { path: string; title: string; description: string }[]>> = {
  fr: [
    { path: "/", title: "Accueil", description: "WEBLACK — Agence créative indépendante" },
    { path: "/about", title: "À propos", description: "L'agence, sa méthode, son équipe" },
    { path: "/talent", title: "Talent", description: "Management, représentation et développement de talents" },
    { path: "/creative", title: "Créatif", description: "Direction créative, campagnes, production de contenu" },
    { path: "/consulting", title: "Consulting", description: "Stratégie de marque et intelligence culturelle" },
    { path: "/selected-work", title: "Projets", description: "Les réalisations WEBLACK" },
    { path: "/journal", title: "Journal", description: "Actualités, analyses et reportages" },
    { path: "/responsibility", title: "Engagements", description: "La responsabilité de WEBLACK" },
    { path: "/partners", title: "Partenaires", description: "Les collaborations WEBLACK" },
    { path: "/live", title: "Live", description: "Les directs WEBLACK" },
    { path: "/contact", title: "Contact", description: "Nous écrire" },
  ],
  en: [
    { path: "/", title: "Home", description: "WEBLACK — Independent creative agency" },
    { path: "/about", title: "About", description: "The agency, its method, its team" },
    { path: "/talent", title: "Talent", description: "Talent management, representation and development" },
    { path: "/creative", title: "Creative", description: "Creative direction, campaigns, content production" },
    { path: "/consulting", title: "Consulting", description: "Brand strategy and cultural intelligence" },
    { path: "/selected-work", title: "Selected Work", description: "WEBLACK's work" },
    { path: "/journal", title: "Journal", description: "News, analysis and reports" },
    { path: "/responsibility", title: "Responsibility", description: "WEBLACK's responsibility" },
    { path: "/partners", title: "Partners", description: "WEBLACK's collaborations" },
    { path: "/live", title: "Live", description: "WEBLACK's live broadcasts" },
    { path: "/contact", title: "Contact", description: "Get in touch" },
  ],
};

export async function buildSearchIndex(lang: Lang): Promise<SearchEntry[]> {
  const [journal, work, talent] = await Promise.all([
    getEntriesByLang("journal", lang),
    getEntriesByLang("work", lang),
    getEntriesByLang("talent", lang),
  ]);

  const pages: SearchEntry[] = (STATIC_PAGES[lang] ?? STATIC_PAGES[defaultLang]!).map((page) => ({
    title: page.title,
    description: page.description,
    url: page.path,
    type: "page",
  }));

  const journalEntries: SearchEntry[] = journal.map((entry) => ({
    title: entry.data.title,
    description: entry.data.excerpt,
    url: localizedPath(lang, `/journal/${entry.data.slug}`),
    type: "journal",
  }));

  const workEntries: SearchEntry[] = work.map((entry) => ({
    title: entry.data.title,
    description: `${entry.data.client} — ${entry.data.year}`,
    url: localizedPath(lang, `/selected-work/${entry.data.slug}`),
    type: "work",
  }));

  const talentEntries: SearchEntry[] = talent.map((entry) => ({
    title: entry.data.name,
    description: entry.data.role,
    url: localizedPath(lang, `/talent/${entry.data.slug}`),
    type: "talent",
  }));

  return [...pages, ...journalEntries, ...workEntries, ...talentEntries];
}
