/**
 * WEBLACK Opportunities — contenu éditorial des annonces (FR/EN).
 *
 * Source unique du TEXTE. Le STATUT (brouillon, vérification, publié,
 * clôturé) et la vérification de l'organisateur ne sont PAS ici : ils vivent
 * en base (table `opportunities`, migrations/0008) et se règlent depuis le
 * tableau de bord /admin/. La fonction functions/opportunities/[[path]].ts
 * applique ce statut à chaque requête (une annonce en brouillon ou en
 * vérification répond 404 ; une annonce clôturée reste lisible, sans appel
 * à candidater).
 *
 * Règle : uniquement des annonces réelles, communiquées par WEBLACK. Rien
 * n'est ajouté au-delà de ce qui a été transmis (aucun frais, aucune
 * rémunération, aucune prestation, aucune garantie de sélection).
 */
import type { Lang } from "../i18n/utils";

export interface OpportunityText {
  title: string;
  summary: string;
  category: string;
  location: string;
  eventDate: string;
  intro: string[];
  criteria: string[];
  documents: string[];
  specialOffer: string;
  notice: string;
}

export interface OpportunityImage {
  src: string;
  width: number;
  height: number;
  alt: Record<Lang, string>;
  caption?: Record<Lang, string>;
}

const podium = (year: number, n: number, width: number, height: number): OpportunityImage => ({
  src: `/photos/zedefile-${year}-podium-${n}.jpg`,
  width,
  height,
  alt: { fr: `Passage sur le podium de ZE DÉFILÉ ${year}, à Paris.`, en: `A runway look at ZE DÉFILÉ ${year}, in Paris.` },
  caption: { fr: `ZE DÉFILÉ ${year}, Paris`, en: `ZE DÉFILÉ ${year}, Paris` },
});

export interface Opportunity {
  slug: string;
  /** Fin de dépôt, heure de Paris, incluse. Au-delà, l'annonce est affichée comme clôturée. */
  deadline: string;
  organizer: { name: string; url?: string };
  /** Diffusion : toujours la marque, jamais la raison sociale. */
  broadcastPartner: string;
  contact: { email: string; phones: { label: string; tel: string }[] };
  /** Visuel principal (public/photos/…, original conservé ; variantes AVIF/WebP générées au build). */
  image?: OpportunityImage;
  /** Image Open Graph 1200×630 dérivée du visuel principal (affiche entière, sans recadrage). */
  ogImage?: string;
  /** Crédit affiché sous les visuels de l'organisateur (réutilisation autorisée, confirmée par WEBLACK le 2026-11-09). */
  imageCredit?: string;
  /** Galeries : visuels officiels, puis photographies des éditions précédentes. */
  galleries?: { id: string; title: Record<Lang, string>; items: OpportunityImage[] }[];
  text: Record<Lang, OpportunityText>;
}

export const OPPORTUNITIES: Opportunity[] = [
  {
    slug: "zedefile-2027",
    deadline: "2026-12-01T23:59:59+01:00",
    organizer: { name: "ZEDEFILE / Association WAXFASHION", url: "https://zedefile.com/" },
    image: {
      src: "/photos/zedefile-2027-affiche-violet.jpg",
      width: 1080,
      height: 1350,
      alt: {
        fr: "Affiche officielle de ZE DÉFILÉ, présentée par l'Association WAXFASHION : « RDV avril 2027 », un mannequin en robe violette sur le podium.",
        en: "Official ZE DÉFILÉ poster presented by Association WAXFASHION: “RDV avril 2027”, a model in a purple gown on the runway.",
      },
    },
    ogImage: "/photos/og-zedefile-2027.jpg",
    imageCredit: "© WaxFashion — ZE DÉFILÉ",
    galleries: [
      {
        id: "official",
        title: { fr: "Visuels officiels 2027", en: "Official 2027 visuals" },
        items: [
          {
            src: "/photos/zedefile-2027-affiche-turquoise.jpg",
            width: 1080,
            height: 1350,
            alt: {
              fr: "Affiche officielle ZE DÉFILÉ « RDV avril 2027 », version turquoise : un mannequin en robe à volants imprimée sur le podium.",
              en: "Official ZE DÉFILÉ “RDV avril 2027” poster, turquoise version: a model in a printed ruffled gown on the runway.",
            },
          },
          {
            src: "/photos/zedefile-2027-affiche-rouge.jpg",
            width: 1080,
            height: 1350,
            alt: {
              fr: "Affiche officielle ZE DÉFILÉ « RDV avril 2027 », version rouge : une mannequin en tailleur noir et chapeau rouge.",
              en: "Official ZE DÉFILÉ “RDV avril 2027” poster, red version: a model in a black suit and red hat.",
            },
          },
        ],
      },
      {
        id: "editions",
        title: { fr: "Éditions précédentes", en: "Previous editions" },
        items: [podium(2026, 1, 1600, 2400), podium(2026, 2, 1600, 2400), podium(2025, 1, 1600, 2400), podium(2025, 2, 1600, 2400), podium(2024, 1, 1600, 2000), podium(2024, 2, 1600, 2398)],
      },
    ],
    broadcastPartner: "WEBLACK",
    contact: {
      email: "weblackconsulting@gmail.com",
      phones: [
        { label: "+47 48 42 80 39", tel: "+4748428039" },
        { label: "+33 7 43 70 00 63", tel: "+33743700063" },
      ],
    },
    text: {
      fr: {
        title: "ZEDEFILE 2027 — Appel à candidatures",
        summary: "Sélection de designers pour l'édition 2027 de ZEDEFILE, Annual Fashion Show à Paris.",
        category: "Mode · Designers",
        location: "Paris, France",
        eventDate: "Avril 2027",
        intro: [
          "ZEDEFILE, Annual Fashion Show de Paris, ouvre la sélection des designers de son édition 2027.",
          "L'appel s'adresse aux créateurs et créatrices dont la marque porte déjà une identité affirmée, prêts à présenter leur travail sur un podium parisien.",
        ],
        criteria: [
          "Avoir présenté au moins deux collections, ou justifier de deux années d'expérience.",
          "Disposer d'une marque et d'une identité créative affirmée.",
        ],
        documents: [
          "Six photographies de la dernière collection.",
          "Une biographie professionnelle du créateur ou de la créatrice.",
          "Le logo de la marque en haute résolution.",
          "Une photographie professionnelle du designer.",
        ],
        specialOffer: "Offre spéciale : les conditions sont communiquées sur demande.",
        notice:
          "Aucune information sur des frais, une rémunération ou des prestations n'est publiée ici : elles sont précisées sur demande. Le dépôt d'un dossier ne vaut pas sélection.",
      },
      en: {
        title: "ZEDEFILE 2027 — Call for applications",
        summary: "Designer selection for the 2027 edition of ZEDEFILE, Annual Fashion Show in Paris.",
        category: "Fashion · Designers",
        location: "Paris, France",
        eventDate: "April 2027",
        intro: [
          "ZEDEFILE, the Annual Fashion Show in Paris, is opening designer selection for its 2027 edition.",
          "The call is for designers whose brand already carries a distinct identity and who are ready to show their work on a Paris runway.",
        ],
        criteria: [
          "Have presented at least two collections, or show two years of experience.",
          "Have a brand with a distinct creative identity.",
        ],
        documents: [
          "Six photographs of the latest collection.",
          "A professional biography of the designer.",
          "The brand logo in high resolution.",
          "A professional photograph of the designer.",
        ],
        specialOffer: "Special offer: terms are shared on request.",
        notice:
          "No information on fees, payment or included services is published here: it is shared on request. Submitting a portfolio does not guarantee selection.",
      },
    },
  },
];

export function getOpportunity(slug: string): Opportunity | undefined {
  return OPPORTUNITIES.find((o) => o.slug === slug);
}
