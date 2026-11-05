/**
 * Demande commerciale (brief WEBLACK) — options partagées entre le
 * formulaire (src/components/forms/BusinessInquiryForm.astro) et la
 * validation serveur (inquiryValidation.ts) : une option affichée est
 * forcément acceptée, et inversement.
 *
 * Les prestations sont EXACTEMENT celles que les pages de division
 * présentent déjà (creative.capability.*, consulting.offer.*,
 * talent.capabilities.*) — aucune prestation nouvelle n'est créée ici.
 * Côté Talent, seule la collaboration professionnelle s'ajoute
 * (partenariat de défilé ou d'événement), qui relève de la production mode
 * déjà pratiquée (ZÉ DÉFILÉ, NTA).
 *
 * Les tranches de budget ne sont PAS des tarifs : de simples repères
 * facultatifs, sans valeur éliminatoire.
 */

export const DIVISIONS = ["talent", "creative", "consulting", "unsure"] as const;
export type Division = (typeof DIVISIONS)[number];

export const SERVICES_BY_DIVISION = {
  talent: ["connection", "event_partnership", "representation", "development", "direction", "other"],
  creative: ["direction", "artdirection", "campaign", "fashion", "editorial", "content", "events", "storytelling", "other"],
  consulting: [
    "strategy",
    "positioning",
    "development",
    "creativestrategy",
    "cultural",
    "communication",
    "partnerships",
    "market",
    "other",
  ],
  unsure: ["other"],
} as const satisfies Record<Division, readonly string[]>;

export const TIMELINES = ["under_1_month", "1_3_months", "3_6_months", "over_6_months", "flexible"] as const;
export const BUDGETS = ["under_5k", "5k_15k", "15k_50k", "over_50k", "to_define"] as const;

export const INQUIRY_STATUSES = ["NEW", "TO_QUALIFY", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_LIMITS = {
  name: 120,
  email: 254,
  organisation: 160,
  descriptionMin: 30,
  description: 4000,
  note: 2000,
  channel: 80,
  entryPoint: 40,
} as const;

/** Points d'entrée connus du brief (paramètre ?from=) — toute autre valeur est enregistrée comme "other". */
export const ENTRY_POINTS = ["home", "talent", "creative", "consulting", "contact", "work", "header", "footer", "about", "other"] as const;

/** Conservation d'une demande après sa dernière mise à jour (politique de confidentialité). */
export const INQUIRY_RETENTION_DAYS = 3 * 365;

export function isDivision(value: unknown): value is Division {
  return typeof value === "string" && (DIVISIONS as readonly string[]).includes(value);
}

export function isServiceOf(division: Division, value: unknown): boolean {
  return typeof value === "string" && (SERVICES_BY_DIVISION[division] as readonly string[]).includes(value);
}

export function isInquiryStatus(value: unknown): value is InquiryStatus {
  return typeof value === "string" && (INQUIRY_STATUSES as readonly string[]).includes(value);
}

/** Référence lisible donnée au visiteur, dérivée de l'identifiant. */
export function inquiryReference(id: string): string {
  return `WBL-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
