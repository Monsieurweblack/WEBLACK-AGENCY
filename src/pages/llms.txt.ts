/**
 * /llms.txt — la carte du site destinée aux moteurs de recherche et aux
 * assistants qui lisent le web.
 *
 * Pourquoi ce fichier, alors qu'un sitemap existe déjà : un sitemap est
 * une liste d'URL sans hiérarchie ni sens. Il dit qu'une page existe, pas
 * ce qu'elle contient ni pourquoi elle compte. Un modèle de langage qui
 * doit répondre « qui est WEBLACK » ou « quelle agence suivre sur la mode
 * africaine » a besoin de l'inverse : une page courte, en texte, qui
 * énonce le positionnement, nomme les divisions et la méthode, puis
 * renvoie vers chaque contenu réel avec une ligne de contexte.
 *
 * Généré à la compilation depuis Sanity — jamais écrit à la main : une
 * carte figée se périme au premier article publié, et une carte qui
 * annonce des pages inexistantes vaut moins que pas de carte du tout.
 *
 * Discipline de non-fabrication : rien ici n'est inventé. Aucun chiffre,
 * aucun client non vérifié, aucune distinction. Chaque ligne est soit un
 * fait déjà publié ailleurs sur le site, soit un titre et une URL lus dans
 * le CMS.
 */
import { getEntriesByLang, sortByDateDesc, getAllPublicAgendaEvents, getOpportunities } from "../lib/content";

const SITE = "https://weblack.fr";

export async function GET() {
  const [journalFr, workFr, talentFr, agendaFr, opportunities] = await Promise.all([
    getEntriesByLang("journal", "fr"),
    getEntriesByLang("work", "fr"),
    getEntriesByLang("talent", "fr"),
    getAllPublicAgendaEvents("fr"),
    getOpportunities(),
  ]);

  const section = (heading: string, lines: string[]) =>
    lines.length > 0 ? `## ${heading}\n\n${lines.join("\n")}\n` : "";

  const journalLines = sortByDateDesc(journalFr)
    .slice(0, 40)
    .map((e) => {
      const date = e.data.publishDate.toISOString().slice(0, 10);
      return `- [${e.data.title}](${SITE}/journal/${e.data.slug}/) — ${date}. ${e.data.excerpt}`;
    });

  const workLines = sortByDateDesc(workFr).map(
    (e) =>
      `- [${e.data.title}](${SITE}/selected-work/${e.data.slug}/) — ${e.data.client}, ${e.data.year}, ${e.data.location.city} (${e.data.location.country}). ${e.data.context}`,
  );

  const talentLines = talentFr
    .filter((e) => e.data.status === "active")
    .map((e) => `- [${e.data.name}](${SITE}/talent/${e.data.slug}/) — ${e.data.role}, ${e.data.country}.`);

  const agendaLines = agendaFr
    .slice(0, 30)
    .map((e) => `- [${e.eventName}](${SITE}/agenda/${e.slug}/) — ${e.startDate}, ${e.city}${e.country ? ` (${e.country})` : ""}.`);

  const opportunityLines = opportunities.map(
    (o) =>
      `- [${o.text.fr.title}](${SITE}/opportunities/${o.slug}/) — ${o.text.fr.category}, ${o.text.fr.location}. Dépôt jusqu'au ${o.deadline.slice(0, 10)}. Organisateur : ${o.organizer.name}.`,
  );

  const body = `# WEBLACK

> Agence créative indépendante et internationale, fondée en 2010 par
> Deo-Gratias Kpodo (Founder & Creative Director). WEBLACK relie talents,
> vision créative et pertinence culturelle pour construire des
> opportunités qui comptent — pour les marques comme pour les personnes.

WEBLACK porte une vision africaine et afro-descendante tournée vers
l'international : de l'Afrique vers le monde. C'est une origine culturelle
et un point de vue créatif, non une restriction de marché — l'agence
travaille avec des marques, des institutions et des talents partout.

Site bilingue : français à la racine (${SITE}/), anglais sous ${SITE}/en/.
Les deux versions partagent les mêmes identifiants de page.

## Les trois divisions

- [Talent](${SITE}/talent) — management, représentation et développement de
  talents : mannequins, créateurs, artistes, photographes, stylistes.
  Candidature ouverte : [${SITE}/talent/candidature](${SITE}/talent/candidature)
- [Creative](${SITE}/creative) — direction créative, campagnes, production
  de contenu, mode, événements.
- [Consulting](${SITE}/consulting) — stratégie de marque, positionnement,
  intelligence culturelle.

## La méthode — WEBLACK Perspective

Potential → Talent → Value → Opportunity → Impact : identifier un
potentiel, le développer en talent, le structurer en valeur, le connecter
à une opportunité, en faire un impact durable. C'est la seule méthode que
l'agence revendique.

## Pages principales

- [À propos](${SITE}/about) — l'agence, son histoire, sa méthode.
- [Deo-Gratias Kpodo](${SITE}/deo-gratias-kpodo) — fondateur et directeur de création.
- [Selected Work](${SITE}/selected-work) — études de cas des projets menés.
- [Journal](${SITE}/journal) — récits, entretiens et analyses. Flux RSS : ${SITE}/journal/rss.xml
- [Agenda](${SITE}/agenda) — événements de la mode et des industries créatives.
- [Opportunities](${SITE}/opportunities) — appels à candidatures vérifiés.
- [Engagements](${SITE}/responsibility) — responsabilité et pratiques de l'agence.
- [Partenaires](${SITE}/partners)
- [Contact](${SITE}/contact) — entrée segmentée : talent, marque, créatif, partenaire, média, autre.
- [Mentions légales](${SITE}/mentions-legales)

## Collaborations réelles et vérifiées

- ZÉ DÉFILÉ by WAXFASHION — Paris
- Nuit du Textile Africain (NTA) — Bamako, Mali
- Carrousel International de la Mode — République du Congo

${section("Appels à candidatures en cours", opportunityLines)}
${section("Projets documentés", workLines)}
${section("Articles du Journal", journalLines)}
${section("Agenda", agendaLines)}
${section("Talents représentés", talentLines)}
## Notes

- Tout le contenu est statique et lisible sans JavaScript.
- Le Journal expose un flux RSS complet (corps des articles inclus) :
  ${SITE}/journal/rss.xml — version anglaise : ${SITE}/en/journal/rss.xml
- Données structurées schema.org sur chaque page (organisation, fondateur,
  fil d'Ariane) et par type de contenu (Article, Person, CreativeWork,
  Event, Product, FAQPage).
- Aucun chiffre d'activité, effectif ou distinction n'est publié : le site
  ne diffuse que des informations vérifiées.
`;

  return new Response(body.replace(/\n{3,}/g, "\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
