/**
 * Les trois offres commerciales WEBLACK — contenu bilingue des pages de
 * division et du brief (Growth Sprint 1).
 *
 * Discipline de non-fabrication (CLAUDE.md) : aucune référence client,
 * aucun tarif, aucun résultat chiffré, aucune promesse de délai. Les
 * prestations sont celles déjà publiées sur les pages de division ; les
 * preuves sont les deux projets réels du Studio (ZÉ DÉFILÉ by WAXFASHION,
 * Nuit du Textile Africain), rattachés aux divisions selon leurs
 * disciplines déclarées dans Sanity. Les publics nommés sont ceux à qui
 * l'offre s'ADRESSE, jamais une liste de clients.
 */
import type { Lang } from "../i18n/utils";
import type { Division } from "../../functions/lib/inquiryOptions.ts";

export type OfferDivision = Exclude<Division, "unsure">;

/** Projets réels qui servent de preuve, par division (repérés par fragment de slug, stable entre FR et EN). */
export const PROOF_SLUGS: Record<OfferDivision, readonly string[]> = {
  talent: ["ze-defile"],
  creative: ["ze-defile", "nuit-du-textile"],
  consulting: ["nuit-du-textile", "ze-defile"],
};

interface OfferCopy {
  name: string;
  valueTitle: string;
  value: string;
  audiencesTitle: string;
  audiences: string[];
  benefitsTitle: string;
  benefits: { title: string; body: string }[];
  ctaTitle: string;
  ctaBody: string;
  cta: string;
}

interface SharedCopy {
  briefCta: string;
  workCta: string;
  servicesEyebrow: string;
  proofEyebrow: string;
  proofTitle: string;
  processEyebrow: string;
  processTitle: string;
  process: { title: string; body: string }[];
  otherService: string;
}

export const SHARED: Record<Lang, SharedCopy> = {
  fr: {
    briefCta: "Démarrer un brief",
    workCta: "Voir les réalisations",
    servicesEyebrow: "Prestations",
    proofEyebrow: "Sur le terrain",
    proofTitle: "Des projets réellement menés.",
    processEyebrow: "Comment avancer",
    processTitle: "Du brief à la proposition.",
    process: [
      { title: "Brief", body: "Vous décrivez le projet en quelques minutes. Une référence vous est attribuée dès que la demande est enregistrée." },
      { title: "Qualification", body: "L'équipe WEBLACK étudie la demande et revient vers vous pour en préciser le cadre, les attentes et le calendrier." },
      { title: "Proposition", body: "Une proposition construite pour votre projet : périmètre, calendrier et conditions, avant tout engagement." },
    ],
    otherService: "Autre besoin, à préciser",
  },
  en: {
    briefCta: "Start a brief",
    workCta: "See selected work",
    servicesEyebrow: "Services",
    proofEyebrow: "In the field",
    proofTitle: "Projects actually delivered.",
    processEyebrow: "How to move forward",
    processTitle: "From brief to proposal.",
    process: [
      { title: "Brief", body: "You describe the project in a few minutes. A reference is issued as soon as the request is recorded." },
      { title: "Qualification", body: "The WEBLACK team reviews the request and comes back to you to clarify scope, expectations and timing." },
      { title: "Proposal", body: "A proposal built for your project — scope, timeline and terms — before any commitment." },
    ],
    otherService: "Another need, to be specified",
  },
};

export const OFFERS: Record<Lang, Record<OfferDivision, OfferCopy>> = {
  fr: {
    talent: {
      name: "WEBLACK TALENTS",
      valueTitle: "Relier des talents à des projets qui les engagent.",
      value:
        "WEBLACK développe des talents et les relie à des projets — défilés, campagnes, événements — avec un cadre clair et une exigence de direction. Deux parcours distincts : la candidature individuelle d'un talent, et la demande de collaboration d'un professionnel.",
      audiencesTitle: "Pour les professionnels",
      audiences: ["Promoteurs de défilés", "Marques", "Agences", "Organisateurs d'événements"],
      benefitsTitle: "Ce que la collaboration apporte",
      benefits: [
        { title: "Un interlocuteur unique", body: "Entre votre projet et les talents : une seule équipe pour orienter, cadrer et suivre la collaboration." },
        { title: "Des profils choisis pour le projet", body: "Une sélection guidée par la direction artistique et les besoins réels de votre événement ou campagne." },
        { title: "Un cadre posé d'emblée", body: "Rôle, calendrier et conditions convenus par écrit avant tout engagement, pour vous comme pour le talent." },
      ],
      ctaTitle: "Un défilé, une campagne, un événement ?",
      ctaBody: "Décrivez votre projet : l'équipe WEBLACK étudie chaque demande de collaboration.",
      cta: "Demander une collaboration",
    },
    creative: {
      name: "WEBLACK CRÉATIF",
      valueTitle: "De la direction créative à la production.",
      value:
        "WEBLACK conçoit et produit des univers visuels, des campagnes et des expériences pour les marques, les institutions et les talents. La conception et la production restent sous une même direction, du premier parti pris au dernier livrable.",
      audiencesTitle: "À qui s'adresse l'offre",
      audiences: ["Marques et maisons de mode", "Institutions et organisations culturelles", "Organisateurs de défilés et d'événements", "Talents et créateurs"],
      benefitsTitle: "Ce que vous obtenez",
      benefits: [
        { title: "Une direction qui part du positionnement", body: "Chaque univers visuel découle de ce que la marque ou le projet doit affirmer — jamais d'un gabarit." },
        { title: "Conception et production réunies", body: "Une même équipe pense la campagne, l'événement ou le contenu, puis le produit." },
        { title: "Un regard situé", body: "Une vision africaine et afro-descendante, tournée vers l'international : de l'Afrique vers le monde." },
      ],
      ctaTitle: "Une campagne, un contenu, un événement à créer ?",
      ctaBody: "Décrivez le projet et son échéance : le brief arrive directement à l'équipe créative.",
      cta: "Démarrer un brief créatif",
    },
    consulting: {
      name: "WEBLACK CONSULTING",
      valueTitle: "Clarifier, positionner, développer.",
      value:
        "WEBLACK aide les marques et les institutions à préciser ce qu'elles sont, à qui elles parlent et comment elles se développent, avec une lecture fine des dynamiques culturelles de leurs publics et de leurs marchés.",
      audiencesTitle: "À qui s'adresse l'offre",
      audiences: ["Marques en création ou en repositionnement", "Institutions et organisations", "Créateurs et entrepreneurs culturels", "Projets et événements mode"],
      benefitsTitle: "Ce que vous obtenez",
      benefits: [
        { title: "Un diagnostic et une feuille de route", body: "Une lecture claire de la situation de la marque et des priorités pour avancer." },
        { title: "Un positionnement relié à l'expression", body: "La stratégie et la création parlent le même langage : ce qui est décidé se voit." },
        { title: "Une intelligence culturelle", body: "Les codes, les publics et les marchés lus avec précision, au service des décisions." },
      ],
      ctaTitle: "Une marque à structurer ou à repositionner ?",
      ctaBody: "Décrivez votre enjeu : l'équipe consulting revient vers vous pour en cadrer l'approche.",
      cta: "Démarrer un brief consulting",
    },
  },
  en: {
    talent: {
      name: "WEBLACK TALENTS",
      valueTitle: "Connecting talent with projects that matter to them.",
      value:
        "WEBLACK develops talent and connects it with projects — runway shows, campaigns, events — within a clear framework and with a demanding sense of direction. Two separate paths: an individual talent's application, and a professional's collaboration request.",
      audiencesTitle: "For professionals",
      audiences: ["Fashion show promoters", "Brands", "Agencies", "Event organisers"],
      benefitsTitle: "What a collaboration brings",
      benefits: [
        { title: "One point of contact", body: "Between your project and the talent: a single team to guide, frame and follow the collaboration." },
        { title: "Profiles chosen for the project", body: "A selection led by the art direction and the actual needs of your event or campaign." },
        { title: "A framework set from the start", body: "Role, timeline and terms agreed in writing before any commitment — for you and for the talent." },
      ],
      ctaTitle: "A runway show, a campaign, an event?",
      ctaBody: "Describe your project: the WEBLACK team reviews every collaboration request.",
      cta: "Request a collaboration",
    },
    creative: {
      name: "WEBLACK CREATIVE",
      valueTitle: "From creative direction to production.",
      value:
        "WEBLACK designs and produces visual worlds, campaigns and experiences for brands, institutions and talent. Concept and production stay under one direction, from the first creative stance to the final deliverable.",
      audiencesTitle: "Who it is for",
      audiences: ["Brands and fashion houses", "Institutions and cultural organisations", "Fashion show and event organisers", "Talent and creators"],
      benefitsTitle: "What you get",
      benefits: [
        { title: "Direction that starts from positioning", body: "Every visual world follows from what the brand or project needs to assert — never from a template." },
        { title: "Concept and production together", body: "The same team thinks through the campaign, event or content, then produces it." },
        { title: "A situated perspective", body: "An African and Afro-descendant vision, facing the world: from Africa to the world." },
      ],
      ctaTitle: "A campaign, content or an event to create?",
      ctaBody: "Describe the project and its timing: the brief goes straight to the creative team.",
      cta: "Start a creative brief",
    },
    consulting: {
      name: "WEBLACK CONSULTING",
      valueTitle: "Clarify, position, grow.",
      value:
        "WEBLACK helps brands and institutions define what they are, who they speak to and how they grow, with a close reading of the cultural dynamics of their audiences and markets.",
      audiencesTitle: "Who it is for",
      audiences: ["Brands launching or repositioning", "Institutions and organisations", "Creators and cultural entrepreneurs", "Fashion projects and events"],
      benefitsTitle: "What you get",
      benefits: [
        { title: "A diagnosis and a roadmap", body: "A clear reading of where the brand stands and what to prioritise next." },
        { title: "Positioning tied to expression", body: "Strategy and creative speak the same language: what is decided becomes visible." },
        { title: "Cultural intelligence", body: "Codes, audiences and markets read precisely, in service of decisions." },
      ],
      ctaTitle: "A brand to structure or reposition?",
      ctaBody: "Describe your challenge: the consulting team comes back to you to frame the approach.",
      cta: "Start a consulting brief",
    },
  },
};

/** Collaboration professionnelle Talent : libellés des prestations propres à cette division. */
export const TALENT_SERVICES: Record<Lang, Record<string, { name: string; desc: string }>> = {
  fr: {
    connection: { name: "Mise en relation talents × projets", desc: "Pour un défilé, une campagne ou un événement : une orientation vers des profils adaptés au projet et à sa direction artistique." },
    event_partnership: { name: "Partenariat défilé ou événement", desc: "Une collaboration avec promoteurs et organisateurs : programmation de talents, direction et production mode." },
    representation: { name: "Représentation d'un talent", desc: "Échanger avec WEBLACK au sujet d'un talent qu'elle accompagne, pour un projet précis." },
    development: { name: "Développement de talent", desc: "Un accompagnement structuré de la trajectoire d'un talent, sur proposition et étude." },
    direction: { name: "Direction & image", desc: "La direction de l'image d'un talent pour un projet, une campagne ou une prise de parole." },
  },
  en: {
    connection: { name: "Talent × project matching", desc: "For a runway show, a campaign or an event: guidance towards profiles suited to the project and its art direction." },
    event_partnership: { name: "Runway or event partnership", desc: "A collaboration with promoters and organisers: talent programming, direction and fashion production." },
    representation: { name: "Talent representation", desc: "Talk to WEBLACK about a talent it works with, for a specific project." },
    development: { name: "Talent development", desc: "Structured support for a talent's trajectory, upon proposal and review." },
    direction: { name: "Direction & image", desc: "Directing a talent's image for a project, a campaign or a public appearance." },
  },
};

/** Avertissement Talent — jamais de financement ni de représentation garantie. */
export const TALENT_TERMS: Record<Lang, string> = {
  fr: "WEBLACK ne finance pas la participation des talents aux événements et ne garantit ni représentation ni engagement. Chaque collaboration est étudiée, puis proposée et contractualisée au cas par cas, selon les prestations effectivement fournies par WEBLACK.",
  en: "WEBLACK does not fund talent participation in events and guarantees neither representation nor bookings. Each collaboration is reviewed, then proposed and contracted case by case, based on the services WEBLACK actually provides.",
};

/**
 * Lien vers le brief, division (et prestation) présélectionnées, point
 * d'entrée noté pour le canal d'origine. Le brief relit ces paramètres
 * contre la même liste fermée que le serveur : une valeur inconnue est
 * ignorée, jamais injectée.
 */
export function briefPath(lang: Lang, params: { division?: Division; service?: string; from?: string } = {}): string {
  const search = new URLSearchParams();
  if (params.division) search.set("division", params.division);
  if (params.service) search.set("service", params.service);
  if (params.from) search.set("from", params.from);
  const query = search.toString();
  return `${lang === "fr" ? "" : `/${lang}`}/brief/${query ? `?${query}` : ""}`;
}

/** Lien du bandeau Talent vers le parcours professionnel. */
export const TALENT_PRO_LINK: Record<Lang, string> = {
  fr: "Vous êtes un professionnel ? Collaborer",
  en: "A professional? Collaborate",
};
