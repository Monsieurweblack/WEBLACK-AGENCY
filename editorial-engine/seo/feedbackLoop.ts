import type { SearchPerformanceRow } from "../intelligence/searchConsole.ts";
import { fetchSearchPerformance, isSearchConsoleConnected } from "../intelligence/searchConsole.ts";

export type SeoRecommendation = "IMPROVE_TITLE" | "IMPROVE_META" | "EXPAND_CONTENT" | "UPDATE_CONTENT" | "INTERNAL_LINKING" | "NO_ACTION";

export interface PageRecommendation {
  page: string;
  recommendation: SeoRecommendation;
  reason: string;
  metrics: SearchPerformanceRow;
}

/**
 * §13 — ARTICLE -> INDEXATION -> SEARCH PERFORMANCE -> ANALYSIS ->
 * OPTIMIZATION. The pure decision logic below only needs a
 * SearchPerformanceRow to run and is fully testable today; the data feeding
 * it (recommendForPages) requires a real Search Console connection, which
 * this environment doesn't have (see intelligence/searchConsole.ts) — it
 * throws rather than inventing rows.
 */
export function recommendForRow(row: SearchPerformanceRow): PageRecommendation {
  // High impressions, low clicks -> the page is being shown but not chosen: title/meta aren't compelling enough.
  if (row.impressions >= 100 && row.ctr < 0.02) {
    return { page: row.page, recommendation: "IMPROVE_TITLE", reason: `${row.impressions} impressions mais CTR ${(row.ctr * 100).toFixed(1)}% — le titre ne convertit pas l'affichage en clic`, metrics: row };
  }
  if (row.impressions >= 100 && row.ctr < 0.04) {
    return { page: row.page, recommendation: "IMPROVE_META", reason: `CTR ${(row.ctr * 100).toFixed(1)}% en dessous de la moyenne pour ce volume d'impressions`, metrics: row };
  }
  // Position 5-20: visible to Google, not yet to most users — classic "needs more depth/authority" zone.
  if (row.position >= 5 && row.position <= 20) {
    return { page: row.page, recommendation: "EXPAND_CONTENT", reason: `Position moyenne ${row.position.toFixed(1)} — page déjà indexée et pertinente, probablement freinée par un contenu insuffisamment complet`, metrics: row };
  }
  if (row.position > 20 && row.impressions > 0) {
    return { page: row.page, recommendation: "INTERNAL_LINKING", reason: `Position ${row.position.toFixed(1)}, peu d'autorité interne — un meilleur maillage peut aider`, metrics: row };
  }
  if (row.impressions === 0) {
    return { page: row.page, recommendation: "UPDATE_CONTENT", reason: "Aucune impression — probablement désindexé, obsolète ou jamais réellement exploré par Google", metrics: row };
  }
  return { page: row.page, recommendation: "NO_ACTION", reason: "Performance dans la norme, rien à changer pour l'instant", metrics: row };
}

/** Orchestrator — real end-to-end use requires a connected Search Console; throws otherwise instead of fabricating a report. */
export async function recommendForPages(sinceDate: string): Promise<PageRecommendation[]> {
  if (!isSearchConsoleConnected()) {
    throw new Error("Search Console non connecté — voir intelligence/searchConsole.ts pour la procédure de connexion. Aucune recommandation ne peut être produite sans données réelles.");
  }
  const rows = await fetchSearchPerformance(sinceDate);
  return rows.map(recommendForRow);
}
