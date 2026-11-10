/** Libellés de WEBLACK Opportunities (catalogue et fiche), FR/EN. */
import type { Lang } from "../i18n/utils";

export const OPPORTUNITY_COPY = {
  fr: {
    catalogSeoTitle: "Opportunities",
    catalogEyebrow: "WEBLACK Opportunities",
    catalogTitle: "Des opportunités réelles, transmises par WEBLACK.",
    catalogLead:
      "Appels à candidatures, sélections et projets ouverts aux talents et aux marques de la création. Chaque annonce publiée ici est communiquée par WEBLACK, avec ses conditions et sa date limite.",
    empty: "Aucune opportunité ouverte pour le moment.",
    deadline: "Date limite",
    event: "Événement",
    location: "Lieu",
    category: "Catégorie",
    organizer: "Organisateur",
    broadcast: "Partenaire de diffusion",
    open: "Ouvert aux candidatures",
    closed: "Clôturé",
    view: "Voir l'annonce",
    back: "Toutes les opportunités",
    about: "L'appel",
    criteria: "Critères de sélection",
    documents: "Pièces à fournir",
    contactTitle: "Demander les conditions",
    contactLead:
      "Les conditions de l'offre spéciale et les modalités d'envoi du dossier sont communiquées par WEBLACK sur demande.",
    contactCta: "Écrire à WEBLACK",
    jump: "Demander les conditions",
    checkedOn: "Informations vérifiées par WEBLACK le",
    archives: "Archives",
    call: "Appeler",
    closedLead: "Cet appel est clôturé : les candidatures ne sont plus reçues.",
    organizerSite: "Site de l'organisateur",
    verifiedNote: "Annonce confirmée par l'organisateur.",
    pendingNote: "Annonce diffusée par WEBLACK ; la confirmation de l'organisateur est en cours.",
    mailSubject: "Demande d'informations",
    mailBody: "Bonjour,\n\nJe souhaite recevoir les conditions de l'offre spéciale et les modalités d'envoi du dossier.\n\nNom :\nMarque :\nVille / pays :\nSite ou Instagram de la marque :\n\nMerci.",
  },
  en: {
    catalogSeoTitle: "Opportunities",
    catalogEyebrow: "WEBLACK Opportunities",
    catalogTitle: "Real opportunities, shared by WEBLACK.",
    catalogLead:
      "Calls for applications, selections and open projects for creative talent and brands. Every listing published here is shared by WEBLACK, with its terms and its deadline.",
    empty: "No open opportunities at the moment.",
    deadline: "Deadline",
    event: "Event",
    location: "Location",
    category: "Category",
    organizer: "Organiser",
    broadcast: "Broadcast partner",
    open: "Open for applications",
    closed: "Closed",
    view: "View listing",
    back: "All opportunities",
    about: "The call",
    criteria: "Selection criteria",
    documents: "Required documents",
    contactTitle: "Request the terms",
    contactLead: "The special offer terms and how to send your portfolio are shared by WEBLACK on request.",
    contactCta: "Email WEBLACK",
    jump: "Request the terms",
    checkedOn: "Information checked by WEBLACK on",
    archives: "Archives",
    call: "Call",
    closedLead: "This call is closed: applications are no longer accepted.",
    organizerSite: "Organiser's website",
    verifiedNote: "Listing confirmed by the organiser.",
    pendingNote: "Listing shared by WEBLACK; confirmation from the organiser is in progress.",
    mailSubject: "Information request",
    mailBody: "Hello,\n\nI would like to receive the special offer terms and how to send my portfolio.\n\nName:\nBrand:\nCity / country:\nBrand website or Instagram:\n\nThank you.",
  },
} as const satisfies Record<Lang, Record<string, string>>;

/** « 1er décembre 2026 » / « 1 December 2026 », heure de Paris. */
export function formatDeadline(iso: string, lang: Lang): string {
  const d = new Date(iso);
  const text = d.toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  return lang === "fr" ? text.replace(/^1 /, "1er ") : text;
}

/** Tailles du visuel principal d'une fiche : identiques pour le <picture> et le préchargement LCP. */
export const OPPORTUNITY_HERO_SIZES = "(min-width: 1024px) 26rem, (min-width: 448px) 28rem, 100vw";
