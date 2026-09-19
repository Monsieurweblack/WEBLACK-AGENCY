import type { FreshnessBand } from "./types.ts";
import { NOW_POLICY } from "./types.ts";

/**
 * §8 — politique de fraîcheur, documentée en un seul endroit et purement
 * déterministe (aucun appel modèle : la fraîcheur est un fait de calendrier,
 * pas un jugement).
 *
 * La date de référence est la plus ancienne information fiable dont on
 * dispose sur le signal : sourcePublishedAt (le flux le date) si elle
 * existe, sinon discoveredAt (le moment où le moteur l'a vu). Ne jamais
 * préférer discoveredAt quand sourcePublishedAt existe — sans quoi un
 * signal republié tardivement paraîtrait plus frais qu'il ne l'est.
 */
export function freshnessBand(
  reference: { sourcePublishedAt?: string; discoveredAt: string },
  now: Date = new Date(),
): FreshnessBand {
  const dateStr = reference.sourcePublishedAt || reference.discoveredAt;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "EXPIRED"; // une date illisible ne peut jamais se faire passer pour fraîche

  const ageHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
  if (ageHours < 0) return "FRESH"; // horloge de flux légèrement en avance — traité comme frais, jamais comme une erreur qui bloque
  if (ageHours <= NOW_POLICY.freshnessBands.freshHours) return "FRESH";
  if (ageHours <= NOW_POLICY.freshnessBands.currentDays * 24) return "CURRENT";
  if (ageHours <= NOW_POLICY.freshnessBands.historicalDays * 24) return "HISTORICAL";
  return "EXPIRED";
}

/**
 * §8, "IMPORTANT" — sortir du radar n'est pas être supprimé. Cette fonction
 * répond uniquement à "peut-on encore le montrer sur NOW aujourd'hui ?" ; le
 * document (local ou Sanity) n'est jamais touché par cet appel.
 */
export function isEligibleForDisplay(band: FreshnessBand): boolean {
  return band === "FRESH" || band === "CURRENT";
}

/** Barème déterministe utilisé par now/relevance.ts — §9 : chaque facteur doit être traçable, pas seulement le total. */
export function freshnessPoints(band: FreshnessBand): number {
  switch (band) {
    case "FRESH":
      return 100;
    case "CURRENT":
      return 60;
    case "HISTORICAL":
      return 20;
    case "EXPIRED":
      return 0;
  }
}
