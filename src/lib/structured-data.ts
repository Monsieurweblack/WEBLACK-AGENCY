/**
 * Données structurées des types de contenu du site.
 *
 * Le graphe institutionnel (organisation, fondateur, site, fil d'Ariane)
 * vit dans src/components/layout/Seo.astro et est émis sur chaque page.
 * Ce module couvre ce qui lui manquait : les entités que le site publie
 * réellement — un talent, un projet, un appel à candidatures, une liste.
 *
 * Sans elles, un moteur — génératif ou non — ne lisait sur /talent/<nom>
 * qu'une « WebPage » appartenant à WEBLACK : pas une personne, pas un
 * métier, pas un pays. Il ne pouvait donc ni la citer en réponse à une
 * question sur un profil, ni rattacher ce profil à l'agence.
 *
 * Toutes les fonctions suivent la même discipline que le reste du site :
 * aucun champ n'est déduit ni comblé. Une valeur absente du CMS est
 * absente du balisage — jamais une chaîne vide, jamais une estimation.
 * C'est pour cela qu'elles construisent l'objet par ajouts conditionnels
 * plutôt que par un littéral complet.
 */
import type { Lang } from "../i18n/utils";
import { LOCALES } from "../i18n/locales";
import type { TalentEntry, WorkEntry, TalentFaqItem } from "./content";
import type { Opportunity } from "./opportunities";

const SITE = "https://weblack.fr";

export function orgId(lang: Lang): string {
  return `${SITE}${lang === "fr" ? "/" : `/${lang}/`}#organization`;
}

function absolute(url: string): string {
  return url.startsWith("http") ? url : new URL(url, SITE).toString();
}

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Un talent, comme personne.
 *
 * `jobTitle` porte le rôle tel qu'il est écrit dans le CMS, et non la
 * catégorie interne (« model », « designer ») : c'est le libellé qu'un
 * humain lit sur la page, donc le seul qui soit vrai. `worksFor` n'est pas
 * employé — un talent représenté n'est pas un salarié ; la relation juste
 * est une représentation, exprimée par `memberOf` et, côté organisation,
 * par l'appartenance à la liste du réseau.
 */
export function talentPersonSchema(talent: TalentEntry, lang: Lang, canonical: string) {
  const d = talent.data;
  const bio = strip(d.bioHtml);
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": canonical,
    url: canonical,
    inLanguage: LOCALES[lang].hreflang,
    isPartOf: { "@id": `${SITE}${lang === "fr" ? "/" : `/${lang}/`}#website` },
    mainEntity: {
      "@type": "Person",
      "@id": `${canonical}#person`,
      name: d.name,
      jobTitle: d.role,
      nationality: d.country,
      image: absolute(d.portraitImage.url),
      ...(bio ? { description: bio.slice(0, 500) } : {}),
      ...(d.specialties?.length ? { knowsAbout: d.specialties } : {}),
      // Représenté par l'agence — pas employé par elle.
      memberOf: { "@id": orgId(lang) },
      ...(d.instagram || d.portfolioUrl
        ? { sameAs: [d.instagram, d.portfolioUrl].filter((u): u is string => Boolean(u)) }
        : {}),
    },
  };
}

/**
 * Un projet (Selected Work), comme œuvre.
 *
 * `CreativeWork` plutôt qu'`Article` : la page ne raconte pas une
 * actualité, elle documente une réalisation — un client, une année, un
 * lieu, des disciplines. `about` porte les disciplines réelles : c'est par
 * elles qu'un moteur génératif rapproche ce projet d'une question sur la
 * mode, la direction artistique ou l'événementiel.
 */
export function workCreativeWorkSchema(work: WorkEntry, lang: Lang, canonical: string) {
  const d = work.data;
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": canonical,
    url: canonical,
    name: d.title,
    description: d.context,
    image: absolute(d.coverImage.url),
    inLanguage: LOCALES[lang].hreflang,
    dateCreated: String(d.year),
    datePublished: d.startDate.toISOString(),
    creator: { "@id": orgId(lang) },
    ...(d.client ? { sourceOrganization: { "@type": "Organization", name: d.client } } : {}),
    ...(d.disciplines?.length ? { about: d.disciplines.map((name) => ({ "@type": "Thing", name })), genre: d.disciplines } : {}),
    ...(d.location?.city
      ? {
          locationCreated: {
            "@type": "Place",
            address: {
              "@type": "PostalAddress",
              addressLocality: d.location.city,
              ...(d.location.country ? { addressCountry: d.location.country } : {}),
            },
          },
        }
      : {}),
    isPartOf: {
      "@type": "CollectionPage",
      "@id": `${SITE}${lang === "fr" ? "" : `/${lang}`}/selected-work/`,
    },
  };
}

/**
 * Un appel à candidatures.
 *
 * Volontairement pas un `Event` : la date de l'événement lui-même n'existe
 * dans le CMS qu'en texte libre (« mars 2027 »), non convertible en date
 * ISO sans la deviner — et `Event` sans `startDate` valide n'est pas un
 * `Event`. Ce qui est daté avec certitude, c'est la clôture du dépôt :
 * `expires` le dit exactement, et `ApplyAction.endTime` le répète sous la
 * forme d'une action, ce qu'une annonce d'appel est réellement.
 */
export function opportunitySchema(o: Opportunity, lang: Lang, canonical: string) {
  const x = o.text[lang];
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonical,
    url: canonical,
    name: x.title,
    description: x.summary,
    inLanguage: LOCALES[lang].hreflang,
    ...(o.image ? { image: absolute(o.image.src) } : {}),
    // Date de dernière vérification de l'annonce auprès de la source : le
    // seul horodatage que le site tienne réellement pour ces pages.
    dateModified: o.lastVerifiedAt,
    expires: o.deadline,
    isAccessibleForFree: true,
    publisher: { "@id": orgId(lang) },
    ...(x.category ? { about: { "@type": "Thing", name: x.category } } : {}),
    ...(o.organizer?.name
      ? {
          sourceOrganization: {
            "@type": "Organization",
            name: o.organizer.name,
            ...(o.organizer.url ? { url: o.organizer.url } : {}),
          },
        }
      : {}),
    ...(x.location
      ? { contentLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: x.location } } }
      : {}),
    potentialAction: {
      "@type": "ApplyAction",
      name: x.title,
      endTime: o.deadline,
      target: `mailto:${o.contact.email}`,
    },
  };
}

/**
 * Une page de rubrique, comme collection ordonnée.
 *
 * Une liste nue de liens n'apprend rien à un moteur : rien ne dit que ces
 * trente URL forment un même ensemble, ni dans quel ordre. `ItemList`
 * l'établit, et c'est ce qui permet à une réponse générative d'énumérer —
 * « le réseau WEBLACK compte ces profils » — au lieu de citer une page au
 * hasard. Plafonnée à cinquante entrées : au-delà, le balisage grossit
 * sans qu'aucun moteur n'en lise davantage.
 */
export function collectionSchema(
  { lang, canonical, name, description, items }: {
    lang: Lang;
    canonical: string;
    name: string;
    description: string;
    items: { url: string; name: string; image?: string }[];
  },
) {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": canonical,
    url: canonical,
    name,
    description,
    inLanguage: LOCALES[lang].hreflang,
    isPartOf: { "@id": `${SITE}${lang === "fr" ? "/" : `/${lang}/`}#website` },
    publisher: { "@id": orgId(lang) },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: items.slice(0, 50).map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: absolute(item.url),
        name: item.name,
        ...(item.image ? { image: absolute(item.image) } : {}),
      })),
    },
  };
}

/**
 * Les questions fréquentes de la candidature Talent.
 *
 * Ce sont des questions et des réponses réelles, écrites dans Studio et
 * déjà affichées sur la page : les baliser ne crée aucun contenu, cela
 * rend lisible par une machine ce qu'un visiteur lit déjà. C'est le seul
 * format que les moteurs génératifs reprennent presque mot pour mot — une
 * question posée à un assistant ressemble beaucoup plus à « comment
 * candidater chez WEBLACK » qu'à un mot-clé.
 */
export function faqSchema(items: TalentFaqItem[], canonical: string, lang: Lang) {
  const usable = items.filter((item) => item.question?.trim() && item.answer?.trim());
  if (usable.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${canonical}#faq`,
    inLanguage: LOCALES[lang].hreflang,
    mainEntity: usable.map((item) => ({
      "@type": "Question",
      name: item.question.trim(),
      acceptedAnswer: { "@type": "Answer", text: strip(item.answer) },
    })),
  };
}
