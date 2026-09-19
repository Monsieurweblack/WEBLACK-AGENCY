import type { AntiFabricationResult } from "../validation/antiFabrication.ts";
import type { NowDuplicateDecision } from "./dedupe.ts";
import type { FreshnessBand, NowSignalStatus, WeblackTerritory } from "./types.ts";
import { NOW_POLICY } from "./types.ts";
import { isEligibleForDisplay } from "./freshness.ts";
import { log } from "../logs/logger.ts";

/**
 * §10 — WEBLACK NOW ne publie qu'un signal qui satisfait les huit
 * conditions du brief, composées ici à partir de vérifications qui
 * existent déjà ailleurs dans le moteur (source, fabrication, doublon)
 * plus quatre conditions propres à NOW (identité, date, pertinence,
 * fraîcheur). Aucune n'est nouvelle en esprit — schemaCheck existe déjà
 * dans validation/qualityGate.ts, duplicateCheck dans validation/dedupe.ts
 * — seule leur composition est propre à NOW.
 */
export interface NowGateResult {
  sourceValid: boolean;
  identityValid: boolean;
  dateValid: boolean;
  contentValid: boolean;
  relevanceValid: boolean;
  freshnessValid: boolean;
  noDuplicate: boolean;
  noFabrication: boolean;
  decision: NowSignalStatus; // jamais "discovered" en sortie — un signal qui atteint ce gate a déjà été découvert
  reasons: string[];
}

export interface NowGateInputs {
  title: string;
  summary: string;
  territory: WeblackTerritory;
  /** Requise seulement quand la nature du signal l'implique (ouverture, événement en cours) — voir dateRequired. Une actualité sans date propre (une nomination, par exemple) ne doit pas être rejetée pour l'absence d'un champ qui n'existe nulle part dans la source. */
  date: string;
  dateRequired: boolean;
  sourceUrl: string;
  compositeRelevance: number;
  freshnessBand: FreshnessBand;
  duplicate: NowDuplicateDecision;
  antiFabrication: AntiFabricationResult;
}

export function evaluateNowGate(inputs: NowGateInputs): NowGateResult {
  const reasons: string[] = [];

  const sourceValid = isValidHttpUrl(inputs.sourceUrl);
  if (!sourceValid) reasons.push(`SOURCE VALID: URL absente ou invalide ("${inputs.sourceUrl}").`);

  const identityValid = inputs.title.trim().length > 0 && inputs.territory !== NOW_POLICY.excludedTerritory;
  if (!identityValid) {
    reasons.push(
      inputs.territory === NOW_POLICY.excludedTerritory
        ? "IDENTITY VALID: territoire OUT_OF_TERRITORY — hors sujet WEBLACK par construction."
        : "IDENTITY VALID: titre manquant.",
    );
  }

  const dateValid = !inputs.dateRequired || /^\d{4}-\d{2}-\d{2}$/.test(inputs.date);
  if (!dateValid) reasons.push("DATE VALID: ce type de signal exige une date, absente ou illisible dans la source.");

  const contentValid = inputs.summary.trim().length > 0 && inputs.summary.trim().length <= 400;
  if (!contentValid) reasons.push(`CONTENT VALID: résumé vide ou anormalement long (${inputs.summary.trim().length} caractères).`);

  const relevanceValid = inputs.compositeRelevance >= NOW_POLICY.minCompositeRelevance;
  if (!relevanceValid) reasons.push(`RELEVANCE VALID: score composite ${inputs.compositeRelevance} < seuil ${NOW_POLICY.minCompositeRelevance}.`);

  const freshnessValid = isEligibleForDisplay(inputs.freshnessBand);
  if (!freshnessValid) reasons.push(`FRESHNESS VALID: bande ${inputs.freshnessBand}, hors fenêtre d'affichage NOW.`);

  const noDuplicate = !inputs.duplicate.isDuplicate;
  if (!noDuplicate) reasons.push(`NO DUPLICATE: ${inputs.duplicate.reason}`);

  const noFabrication = inputs.antiFabrication.pass;
  if (!noFabrication) reasons.push(`NO FABRICATION: ${inputs.antiFabrication.unsupportedClaims.length} affirmation(s) non supportée(s) par l'Evidence Pack.`);

  // Bloquant, sans exception : une source invalide, une identité absente, un
  // doublon ou une fabrication ne se rattrapent jamais par un bon score —
  // REJECTED, jamais REVIEW, pour ces quatre-là (même logique que
  // validation/qualityGate.ts : "une condition critique en échec empêche la
  // publication").
  const hardBlockers = !sourceValid || !identityValid || !noDuplicate || !noFabrication;
  // Ce qui reste discutable — une décision humaine peut légitimement
  // trancher autrement (§12) : date manquante sur un signal à la limite,
  // contenu à retravailler, pertinence ou fraîcheur en zone grise.
  const softBlockers = !dateValid || !contentValid || !relevanceValid || !freshnessValid;

  let decision: NowSignalStatus;
  if (hardBlockers) decision = "rejected";
  else if (softBlockers) decision = "review";
  else decision = "published";

  const gate: NowGateResult = {
    sourceValid, identityValid, dateValid, contentValid, relevanceValid, freshnessValid, noDuplicate, noFabrication,
    decision, reasons,
  };
  log("QUALITY CHECK", `NOW gate — ${inputs.title.slice(0, 60)} — décision ${decision}${reasons.length ? " : " + reasons.join(" | ") : ""}`);
  return gate;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
