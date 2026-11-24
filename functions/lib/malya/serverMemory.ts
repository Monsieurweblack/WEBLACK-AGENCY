/**
 * Mémoire professionnelle sur serveur (niveau 2) — NON ACTIVÉE.
 *
 * Elle exige, avant toute activation : comptes et authentification sécurisée,
 * sessions, séparation stricte des utilisateurs, consultation/correction/export/
 * suppression, retrait du consentement, politique de conservation, audit des
 * accès et politique RGPD documentée (docs/malya-v1-1/memoire-et-consentement.md).
 * Rien de cela n'existe encore : cette garde garantit qu'aucun stockage durable
 * n'est possible par accident, quelle que soit la configuration.
 */
export interface ServerMemoryStatus {
  available: false;
  reason: "not_implemented";
  requires: string[];
}

export const SERVER_MEMORY_REQUIREMENTS = [
  "authentification et sessions",
  "isolation par utilisateur testée",
  "consultation, correction, export, suppression",
  "retrait du consentement",
  "politique de conservation et RGPD documentées",
  "audit des accès",
];

export function serverMemoryStatus(): ServerMemoryStatus {
  return { available: false, reason: "not_implemented", requires: SERVER_MEMORY_REQUIREMENTS };
}

/** Toute tentative d'écriture serveur échoue : aucune table de conversation n'existe. */
export function assertServerMemoryDisabled(): never {
  throw new Error("La mémoire serveur n'est pas implémentée : aucune donnée de conversation n'est conservée côté serveur.");
}
