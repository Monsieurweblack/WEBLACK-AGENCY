/**
 * Corpus documentaire sectoriel — sources primaires et institutionnelles.
 *
 * Chaque entrée a été lue par l'assistant de développement sur la page
 * officielle citée le 2026-11-24 (consultedAt) ; le texte est une
 * REFORMULATION courte d'énoncés explicites de la page, jamais une copie
 * de contenu protégé. `validation: "machine-checked"` signifie « lu et
 * recoupé avec la source, pas encore relu par WEBLACK » : tant qu'une
 * entrée n'est pas « human-validated », MALYA le dit.
 *
 * Volontairement absents : tout ce qui n'a pas pu être lu sur une source
 * officielle (plusieurs URL testées ont répondu 404 : Lagos Fashion Week,
 * pages OMPI « mode », UNESCO « économie créative »).
 */
import type { KnowledgeEntry } from "./types.ts";

const D = "2026-11-24";
const REVIEW = "2027-05-24";
const common = { consultedAt: D, verifiedAt: D, nextReviewAt: REVIEW, validation: "machine-checked" as const, reliability: "verified" as const };

export const CORPUS: KnowledgeEntry[] = [
  {
    ...common, id: "fhcm-role", domain: "haute-couture-pret-a-porter", lang: "en", author: "Fédération de la Haute Couture et de la Mode (FHCM)",
    title: { fr: "La FHCM et Paris Fashion Week", en: "The FHCM and Paris Fashion Week" },
    text: {
      fr: "La Fédération de la Haute Couture et de la Mode (FHCM) indique contribuer à consolider Paris dans son rôle de capitale mondiale de la mode. Son site présente la coordination de Paris Fashion Week et de la Haute Couture Week (calendriers et liste des maisons participantes) ainsi que de la Haute Joaillerie.",
      en: "The Fédération de la Haute Couture et de la Mode (FHCM) states that it helps consolidate Paris as the world fashion capital. Its site presents the coordination of Paris Fashion Week and Haute Couture Week (calendars and participating houses) as well as High Jewellery.",
    },
    keywords: ["fhcm", "federation", "haute couture", "paris fashion week", "calendrier", "calendar", "maisons", "houses", "haute joaillerie", "capitale", "capital"],
    source: { label: "FHCM — site officiel", kind: "institutional", url: "https://fhcm.paris/en/" },
    provenance: "Page d'accueil officielle de la FHCM lue le 2026-11-24 ; reformulation d'énoncés explicites. La page ne décrit pas la gouvernance de l'appellation « Haute Couture » : cette question reste sans réponse documentée.",
  },
  {
    ...common, id: "fhcm-cnmi-protocole", domain: "salons-fashion-weeks", lang: "en", author: "Fédération de la Haute Couture et de la Mode (FHCM)",
    title: { fr: "Accord FHCM–CNMI (juin 2026)", en: "FHCM–CNMI agreement (June 2026)" },
    text: {
      fr: "La FHCM rapporte, sur son site, un mémorandum d'entente conclu en juin 2026 avec la Camera Nazionale della Moda Italiana (CNMI) lors du sommet franco-italien, ainsi qu'un cadre d'harmonisation ESG pour la chaîne d'approvisionnement de la mode publié en mai 2026.",
      en: "The FHCM reports on its site a memorandum of understanding signed in June 2026 with the Camera Nazionale della Moda Italiana (CNMI) during the France-Italy Summit, and an ESG harmonization framework for the fashion supply chain from May 2026.",
    },
    keywords: ["fhcm", "cnmi", "memorandum", "memorandum d entente", "france italie", "france italy", "esg", "chaine d approvisionnement", "supply chain", "partenariat", "partnership", "2026"],
    source: { label: "FHCM — actualités du site officiel", kind: "institutional", url: "https://fhcm.paris/en/" },
    provenance: "Rubrique d'actualités de la page d'accueil de la FHCM lue le 2026-11-24 ; actualité datée : à revoir à la date de révision.",
  },
  {
    ...common, id: "cnmi-milano-fashion-week", domain: "salons-fashion-weeks", lang: "en", author: "Camera Nazionale della Moda Italiana (CNMI)",
    title: { fr: "CNMI et Milano Fashion Week", en: "CNMI and Milano Fashion Week" },
    text: {
      fr: "La Camera Nazionale della Moda Italiana (CNMI), basée à Milan, déclare être l'unique propriétaire de la marque « Milano Fashion Week® » et précise que les événements de la Milano Fashion Week® ne sont accessibles que sur invitation. Son site présente aussi des groupes de travail sur la durabilité, des initiatives de diversité et d'inclusion et des programmes pour jeunes talents.",
      en: "The Camera Nazionale della Moda Italiana (CNMI), based in Milan, states that it is the exclusive owner of the “Milano Fashion Week®” trademark and that Milano Fashion Week® events are accessible on an invitation basis only. Its site also lists sustainability working groups, diversity and inclusion initiatives and new-talent programs.",
    },
    keywords: ["cnmi", "camera nazionale", "milan", "milano", "milano fashion week", "marque", "trademark", "invitation", "jeunes talents", "new talents", "durabilite", "sustainability", "fashion week"],
    source: { label: "CNMI — site officiel", kind: "institutional", url: "https://www.cameramoda.it/en/" },
    provenance: "Page d'accueil officielle de la CNMI lue le 2026-11-24 ; citations explicites reformulées.",
  },
  {
    ...common, id: "ifm-grande-ecole", domain: "fashion-business", lang: "en", author: "Institut Français de la Mode (IFM)",
    title: { fr: "Institut Français de la Mode (IFM)", en: "Institut Français de la Mode (IFM)" },
    text: {
      fr: "L'Institut Français de la Mode se présente comme « la Grande École de la mode », qui forme à Paris les talents du design, du management et des savoir-faire. Son site liste des programmes étudiants (dont un bachelor), des formations professionnelles et continues, un Executive MSc en management stratégique de la mode et du luxe, un Advanced Management Program, un Executive MBA Global Fashion Management et l'Incubateur IFM.",
      en: "The Institut Français de la Mode presents itself as “the Grande École of fashion”, training talent in design, management and craftsmanship in Paris. Its site lists student programs (including a Bachelor), professional and continuing education, an Executive MSc in Strategic Management of Fashion and Luxury, an Advanced Management Program, an Executive MBA Global Fashion Management and the Incubateur IFM.",
    },
    keywords: ["ifm", "institut francais de la mode", "ecole", "school", "formation", "training", "mba", "msc", "management", "luxe", "luxury", "incubateur", "incubator", "etudes", "studies", "education"],
    source: { label: "IFM — site officiel", kind: "institutional", url: "https://www.ifmparis.fr/en?lang=en" },
    provenance: "Page d'accueil officielle de l'IFM lue le 2026-11-24 (l'ancienne adresse ifm-paris.com redirige vers ifmparis.fr).",
  },
  {
    ...common, id: "ompi-la-haye-dessins", domain: "createurs-designers", lang: "en", author: "Organisation mondiale de la propriété intellectuelle (OMPI / WIPO)",
    title: { fr: "Protéger ses dessins et modèles à l'international (système de La Haye)", en: "Protecting designs internationally (Hague System)" },
    text: {
      fr: "Selon l'OMPI, le système de La Haye permet d'enregistrer jusqu'à 100 dessins et modèles industriels par une seule demande internationale, avec une protection possible dans 102 pays (85 membres, dont l'ensemble de l'UE et l'Organisation africaine de la propriété intellectuelle, OAPI). Le demandeur choisit les parties contractantes visées, n'a pas besoin d'enregistrement national préalable et paie en francs suisses ; la gestion se fait en ligne via eHague. Ce texte décrit le dispositif tel que présenté par l'OMPI et ne constitue pas un conseil juridique.",
      en: "According to WIPO, the Hague System lets applicants register up to 100 industrial designs in a single international application, with protection possible in 102 countries (85 members, including all EU countries and the African Intellectual Property Organization, OAPI). Applicants choose the contracting parties they designate, need no prior national registration and pay in Swiss francs; management is online through eHague. This describes the system as presented by WIPO and is not legal advice.",
    },
    keywords: ["ompi", "wipo", "la haye", "hague", "dessins", "modeles", "designs", "propriete intellectuelle", "intellectual property", "oapi", "protection", "enregistrement", "registration", "contrefacon", "createur", "designer"],
    source: { label: "OMPI — Système de La Haye", kind: "institutional", url: "https://www.wipo.int/hague/en/" },
    provenance: "Page officielle du système de La Haye lue le 2026-11-24. Chiffres (100 dessins, 102 pays, 85 membres) tels qu'affichés à cette date : susceptibles d'évoluer.",
  },
  {
    ...common, id: "unesco-convention-2005", domain: "industries-creatives", lang: "en", author: "UNESCO",
    title: { fr: "Convention de l'UNESCO de 2005 sur la diversité des expressions culturelles", en: "UNESCO 2005 Convention on the Diversity of Cultural Expressions" },
    text: {
      fr: "L'UNESCO présente la Convention de 2005 sur la protection et la promotion de la diversité des expressions culturelles comme un instrument juridique de sept chapitres, fondé sur les droits humains et les libertés fondamentales. Les objectifs et principes directeurs figurent au chapitre I du texte ; la page consultée ne les détaille pas.",
      en: "UNESCO presents the 2005 Convention on the Protection and Promotion of the Diversity of Cultural Expressions as a legal instrument of seven chapters, based on human rights and fundamental freedoms. Its objectives and guiding principles are in Chapter I of the text; the page consulted does not detail them.",
    },
    keywords: ["unesco", "convention", "2005", "diversite", "diversity", "expressions culturelles", "cultural expressions", "industries creatives", "creative industries", "culture", "politiques culturelles", "cultural policies"],
    source: { label: "UNESCO — Convention de 2005", kind: "institutional", url: "https://www.unesco.org/creativity/en/2005-convention" },
    provenance: "Page officielle lue le 2026-11-24. Seules les affirmations explicites de la page sont reprises.",
  },
  {
    ...common, id: "safw-presentation", domain: "salons-fashion-weeks", lang: "en", author: "South African Fashion Week",
    title: { fr: "South African Fashion Week", en: "South African Fashion Week" },
    text: {
      fr: "Le site de South African Fashion Week affiche le slogan « The Business of Ethical Fashion » et présente, à la date de consultation, des collections Automne/Hiver 27. La page ne précise ni l'opérateur, ni les dates officielles de l'événement : MALYA ne les donne donc pas.",
      en: "The South African Fashion Week site shows the tagline “The Business of Ethical Fashion” and, at the consultation date, presents Autumn/Winter 27 collections. The page does not state the operator or official event dates, so MALYA does not give them.",
    },
    keywords: ["safw", "south african fashion week", "afrique du sud", "south africa", "fashion week", "ethical fashion", "mode ethique", "collections", "automne hiver", "autumn winter", "africaine", "african"],
    source: { label: "South African Fashion Week — site officiel", kind: "professional", url: "https://safashionweek.co.za/" },
    provenance: "Page d'accueil lue le 2026-11-24 ; informations limitées, volontairement non extrapolées.",
  },
];
