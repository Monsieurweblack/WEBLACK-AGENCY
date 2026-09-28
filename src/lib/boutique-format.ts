import type { Lang, UiKey } from "../i18n/utils";
import type { BoutiquePricing } from "./content";
import { intlTagFor } from "../i18n/locales";

/** Le seul endroit qui décide comment un prix s'affiche — jamais dupliqué entre la carte produit, la fiche produit et le JSON-LD. */
export function formatBoutiquePrice(pricing: BoutiquePricing, lang: Lang, t: (key: UiKey) => string): string {
  if (pricing.displayMode === "request" || typeof pricing.amount !== "number" || !pricing.currency) {
    return t("boutique.price.request");
  }
  const amount = new Intl.NumberFormat(intlTagFor(lang), { style: "currency", currency: pricing.currency, maximumFractionDigits: 0 }).format(
    pricing.amount,
  );
  return pricing.displayMode === "from" ? `${t("boutique.price.from")} ${amount}` : amount;
}
