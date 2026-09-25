/**
 * Ce que /live a le droit de montrer, et dans quel ordre.
 *
 * Même principe que src/lib/agenda-public.ts : cette règle ne fait
 * confiance ni à Sanity (un document peut être corrigé à la main dans le
 * Studio sans que quiconque repense au site) ni au calcul de statut lui-même
 * — elle recalcule l'état public à partir des données brutes, systéma-
 * tiquement, pour que toute page (accueil du /live, archive, JSON-LD,
 * sitemap) parte de la même vérité.
 */
import { resolveLiveState, type LiveState, type LiveStateInput, type ControlMode, type ManualLiveStatus } from "./live-state.ts";

export interface LivePublicData {
  id: string;
  slug: string;
  title: string;
  description?: string;
  discipline?: string;
  location?: string;
  eventName?: string;
  eventSlug?: string;
  coverImageUrl?: string;
  coverImageAlt?: string;
  youtubeVideoId: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  timezone?: string;
  chatEnabled: boolean;
  featured: boolean;
  state: LiveState;
  /**
   * Reportés tels quels (pas juste consommés pour calculer `state`) : un
   * composant qui affiche cette entrée côté client doit pouvoir relancer
   * exactement le même calcul avec la même origine de contrôle — sans ça,
   * un live EDITORIAL figé sur REPLAY se ferait recalculer côté client
   * comme si de rien n'était, avec le contrôle automatisé par défaut.
   */
  controlMode: ControlMode;
  manualStatus?: ManualLiveStatus;
  replayEnabled: boolean;
}

/**
 * Un document brut (tel que renvoyé par la requête GROQ) devient une entrée
 * publique — ou disparaît. Rien n'est complété ici : un champ que la source
 * n'a pas donné reste absent.
 */
export function toPublicLive(doc: Record<string, any>, now: Date): LivePublicData | undefined {
  const slug = doc.slug?.current;
  if (typeof slug !== "string" || !slug.trim()) return undefined;
  if (typeof doc.youtubeVideoId !== "string" || !doc.youtubeVideoId.trim()) return undefined;

  const input: LiveStateInput = {
    controlMode: isControlMode(doc.controlMode) ? doc.controlMode : "EDITORIAL",
    manualStatus: isManualStatus(doc.manualStatus) ? doc.manualStatus : undefined,
    visibility: doc.visibility === "draft" ? "draft" : "public",
    youtubeVideoId: doc.youtubeVideoId,
    scheduledStart: typeof doc.scheduledStart === "string" ? doc.scheduledStart : undefined,
    scheduledEnd: typeof doc.scheduledEnd === "string" ? doc.scheduledEnd : undefined,
    replayEnabled: doc.replayEnabled !== false,
  };

  const state = resolveLiveState(input, now);
  if (state === "DRAFT") return undefined;

  return {
    id: doc._id,
    slug,
    title: doc.title ?? "",
    description: doc.description || undefined,
    discipline: doc.discipline || undefined,
    location: doc.location || undefined,
    eventName: doc.eventName || undefined,
    eventSlug: doc.eventSlug || undefined,
    coverImageUrl: doc.coverImageUrl || undefined,
    coverImageAlt: doc.coverImageAlt || undefined,
    youtubeVideoId: doc.youtubeVideoId,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    timezone: doc.timezone || undefined,
    chatEnabled: doc.chatEnabled === true,
    featured: doc.featured === true,
    state,
    controlMode: input.controlMode,
    manualStatus: input.manualStatus,
    replayEnabled: input.replayEnabled,
  };
}

function isControlMode(value: unknown): value is ControlMode {
  return value === "AUTOMATED" || value === "EDITORIAL" || value === "HYBRID";
}

const MANUAL_STATUSES = new Set(["SCHEDULED", "PRELIVE", "ON_AIR", "ENDING", "REPLAY", "ARCHIVED", "CANCELLED"]);
function isManualStatus(value: unknown): value is ManualLiveStatus {
  return typeof value === "string" && MANUAL_STATUSES.has(value);
}

/**
 * La règle de priorité de la page d'accueil /live (Phase 3) — un seul live
 * à la fois, jamais une page vide tant qu'il existe quelque chose à
 * montrer :
 *
 *   1. un ON_AIR (ou ENDING — la diffusion est en train de se terminer,
 *      encore la meilleure chose à montrer) ;
 *   2. sinon le PRELIVE ou SCHEDULED le plus proche dans le temps ;
 *   3. sinon le REPLAY le plus récent ;
 *   4. sinon rien — la page affiche alors son état éditorial vide.
 *
 * `featured` ne sert qu'à départager deux candidats à égalité de priorité
 * (deux ON_AIR n'arrivent normalement jamais — Phase 16, "un seul player
 * actif" — mais la règle doit rester définie).
 */
export function primaryLive(entries: LivePublicData[]): LivePublicData | undefined {
  const onAir = pickBest(entries.filter((e) => e.state === "ON_AIR" || e.state === "ENDING"));
  if (onAir) return onAir;

  const upcoming = entries
    .filter((e) => e.state === "SCHEDULED" || e.state === "PRELIVE")
    .sort((a, b) => (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? ""));
  if (upcoming.length > 0) {
    const soonest = upcoming[0]!.scheduledStart;
    return pickBest(upcoming.filter((e) => e.scheduledStart === soonest));
  }

  const replays = entries
    .filter((e) => e.state === "REPLAY")
    .sort((a, b) => (b.scheduledStart ?? "").localeCompare(a.scheduledStart ?? ""));
  if (replays.length > 0) {
    const latest = replays[0]!.scheduledStart;
    return pickBest(replays.filter((e) => e.scheduledStart === latest));
  }

  return undefined;
}

function pickBest(candidates: LivePublicData[]): LivePublicData | undefined {
  if (candidates.length === 0) return undefined;
  return candidates.find((e) => e.featured) ?? candidates[0];
}

/** L'archive : replays du plus récent au plus ancien — les états en cours ou à venir n'y figurent pas, ils vivent sur /live elle-même. */
export function archiveLives(entries: LivePublicData[]): LivePublicData[] {
  return entries.filter((e) => e.state === "REPLAY" || e.state === "ARCHIVED").sort((a, b) => (b.scheduledStart ?? "").localeCompare(a.scheduledStart ?? ""));
}

/** Les valeurs de filtre réellement présentes dans l'archive — même principe que agendaFacets. */
export function liveFacets(entries: LivePublicData[]): { disciplines: string[]; years: string[] } {
  const disciplines = [...new Set(entries.map((e) => e.discipline).filter((v): v is string => Boolean(v?.trim())))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  const years = [...new Set(entries.map((e) => e.scheduledStart?.slice(0, 4)).filter((v): v is string => Boolean(v)))].sort((a, b) =>
    b.localeCompare(a),
  );
  return { disciplines, years };
}
