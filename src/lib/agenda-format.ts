import type { Lang } from "../i18n/utils";
import { intlTagFor } from "../i18n/locales";
import type { AgendaEventData } from "./content";

/**
 * Mise en forme des dates de l'Agenda.
 *
 * Les dates arrivent en ISO court — « 2026-09-27 » — sans heure ni fuseau.
 * `new Date("2026-09-27")` les interprète à minuit UTC : au moment du build,
 * dans un fuseau en retard sur UTC, l'affichage reculerait d'un jour et
 * annoncerait le 26. On construit donc la date en UTC et on la formate en
 * UTC, pour que le jour affiché soit exactement celui que la source écrit.
 */
function utcDate(iso: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function format(iso: string, lang: Lang, options: Intl.DateTimeFormatOptions): string {
  const date = utcDate(iso);
  if (!date) return iso;
  return date.toLocaleDateString(intlTagFor(lang), { ...options, timeZone: "UTC" });
}

/** « 27 septembre 2026 » — la date complète, telle qu'on l'écrit dans la langue de la page. */
export function longDate(iso: string, lang: Lang): string {
  return format(iso, lang, { day: "numeric", month: "long", year: "numeric" });
}

/** Le jour seul, pour la colonne de gauche. */
export function dayNumber(iso: string, lang: Lang): string {
  return format(iso, lang, { day: "numeric" });
}

/** Le mois abrégé, pour la colonne de gauche. */
export function shortMonth(iso: string, lang: Lang): string {
  return format(iso, lang, { month: "short" }).replace(/\.$/, "");
}

/** Clé de regroupement mensuel — l'agenda se lit par mois, pas en flux continu. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** « Septembre 2026 », en tête de groupe. */
export function monthLabel(iso: string, lang: Lang): string {
  const label = format(`${monthKey(iso)}-01`, lang, { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * La période d'un événement en une ligne : un jour unique, ou un intervalle.
 * Une date de fin identique à la date de début n'est pas répétée — et une
 * date de fin absente n'est jamais inventée à partir du début.
 */
export function dateRange(event: AgendaEventData, lang: Lang, separator: string): string {
  const start = longDate(event.startDate, lang);
  if (!event.endDate || event.endDate === event.startDate) return start;
  return `${start} ${separator} ${longDate(event.endDate, lang)}`;
}

/** Ce que porte l'attribut de filtre « période » : l'événement touche-t-il ce mois, ce trimestre ? */
export function withinDays(event: AgendaEventData, days: number, from = new Date()): boolean {
  const limit = new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return event.startDate <= limit;
}

/** « Lieu, Ville (Pays) », sans virgule orpheline quand une partie manque. */
export function placeLine(event: AgendaEventData): string {
  const place = [event.venue, event.city].filter(Boolean).join(", ");
  return event.country ? `${place} (${event.country})` : place;
}

/**
 * Qui porte l'événement : l'artiste, ou l'institution à défaut.
 *
 * Rien quand l'institution est déjà le lieu affiché juste en dessous —
 * répéter « Station Berlin » au-dessus de « Station Berlin, Berlin »
 * n'apprend rien et fait passer une redite pour une information.
 */
export function whoOf(event: AgendaEventData): string | undefined {
  if (event.artistOrCreator) return event.artistOrCreator;
  if (!event.institution) return undefined;
  const meme = event.institution.trim().toLowerCase();
  return (event.venue ?? "").trim().toLowerCase().includes(meme) ? undefined : event.institution;
}
