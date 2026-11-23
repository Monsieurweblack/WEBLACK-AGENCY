/**
 * Flux RSS du Journal.
 *
 * Le site n'en avait aucun : le Journal n'était atteignable qu'en visitant
 * sa page. Un flux change cela sur deux plans. Pour un lecteur ou un
 * agrégateur, c'est un abonnement. Pour un robot — y compris ceux qui
 * alimentent les moteurs de recherche génératifs — c'est une liste datée,
 * complète et stable des publications, lisible sans exécuter de
 * JavaScript ni analyser une mise en page : la forme la moins ambiguë sous
 * laquelle un site puisse dire « voici ce que j'ai publié, et quand ».
 *
 * Écrit à la main plutôt qu'avec @astrojs/rss : la génération tient en
 * trente lignes et le projet n'ajoute pas une dépendance de build pour
 * cela.
 *
 * L'illustration passe par <media:content> (Media RSS) et non par
 * <enclosure> : la spécification RSS 2.0 exige sur une enclosure un
 * attribut `length` en octets, que la génération statique ne connaît pas
 * (l'image vit sur le CDN Sanity) — un `length="0"` complaisant est
 * signalé par les validateurs. Media RSS n'impose pas cet attribut et est
 * lu par les mêmes agrégateurs.
 *
 * Le corps complet de l'article part dans <content:encoded>, pas seulement
 * le chapeau : c'est ce qui permet à un agrégateur d'afficher le texte, et
 * à un robot de le citer. Le HTML vient du CMS (@portabletext/to-html),
 * donc déjà échappé pour l'affichage ; il est ici enfermé dans un CDATA,
 * et la séquence de fin de CDATA est neutralisée au cas où un contenu la
 * contienne.
 */
import type { Lang } from "../i18n/utils";
import { LOCALES } from "../i18n/locales";
import type { JournalEntry } from "./content";

const SITE = "https://weblack.fr";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

export function journalRss(entries: JournalEntry[], lang: Lang, title: string, description: string): string {
  const prefix = lang === "fr" ? "" : `/${lang}`;
  const feedUrl = `${SITE}${prefix}/journal/rss.xml`;
  const channelUrl = `${SITE}${prefix}/journal/`;
  // Tri décroissant : un flux se lit du plus récent au plus ancien.
  const sorted = [...entries].sort((a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime());
  const lastBuild = sorted[0]?.data.updatedAt ?? sorted[0]?.data.publishDate;

  const items = sorted
    .map((entry) => {
      const d = entry.data;
      const url = `${SITE}${prefix}/journal/${d.slug}/`;
      const image = d.coverImage.url.startsWith("http") ? d.coverImage.url : `${SITE}${d.coverImage.url}`;
      return `    <item>
      <title>${cdata(d.title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <pubDate>${d.publishDate.toUTCString()}</pubDate>
      <description>${cdata(d.excerpt)}</description>
      <category>${xmlEscape(d.category)}</category>${d.author ? `\n      <dc:creator>${cdata(d.author)}</dc:creator>` : ""}
      <media:content url="${xmlEscape(image)}" medium="image" />
      <content:encoded>${cdata(d.bodyHtml)}</content:encoded>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${cdata(title)}</title>
    <link>${xmlEscape(channelUrl)}</link>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${cdata(description)}</description>
    <language>${LOCALES[lang].hreflang}</language>
    <copyright>WEBLACK</copyright>${lastBuild ? `\n    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>` : ""}
${items}
  </channel>
</rss>
`;
}
