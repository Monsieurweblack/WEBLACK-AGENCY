import type { ExtractedFacts, FactEvidence, VerificationStatus, VerifiedFact, VerifiedFactSet } from "./types.ts";
import type { SourceArticle } from "../sources/types.ts";
import { verifyEvidenceAgainstSources, determineStatus, type ClaimType, type RawClaimForTesting, type RegisteredSource } from "../validation/claimRegistry.ts";
import { log } from "../logs/logger.ts";

export type { VerifiedFact, VerifiedFactSet };

const CLAIM_TYPE_BY_CATEGORY: Record<FactEvidence["category"], ClaimType> = {
  person: "name",
  brand: "name",
  organization: "name",
  location: "general",
  date: "date",
  number: "statistic",
  event: "event",
  quote: "quote",
  general: "general",
};

/**
 * Builds the set of facts the writer is allowed to work from, by running
 * each extracted fact through the SAME programmatic verification the final
 * fact-check pass uses (validation/claimRegistry.ts) — no new model call,
 * no new store, no second fact-checking system.
 *
 * At this stage the fact and its evidence are both in the source's own
 * language, so verification is a pure verbatim check against the real
 * source text. Cross-language verification stays where it belongs: on the
 * generated French article, in the final pass after writing.
 *
 * The point is to remove hallucination fuel at the source rather than to
 * add another layer of control after the fact: an unverifiable fact is
 * dropped here, so the writer never sees it and cannot build on it.
 */
export function buildVerifiedFactSet(facts: ExtractedFacts, source: SourceArticle): VerifiedFactSet {
  const registeredSources: RegisteredSource[] = [{ source }];
  const sourceLanguage = facts.sourceLanguage || "";
  const verified: VerifiedFact[] = [];
  const partiallyVerified: VerifiedFact[] = [];
  const rejected: { fact: string; status: VerificationStatus }[] = [];

  for (const entry of facts.factEvidence ?? []) {
    const rawClaim: RawClaimForTesting = {
      claim: entry.fact,
      claimLanguage: sourceLanguage,
      type: CLAIM_TYPE_BY_CATEGORY[entry.category] ?? "general",
      importance: entry.importance,
      confidence: 0, // never read by determineStatus — a model's self-reported confidence is not evidence
      publishedFactElements: {},
      sourceEvidence: [
        {
          sourceIndex: 0,
          sourceLanguage,
          evidenceQuote: entry.evidenceQuote,
          evidenceTranslation: entry.evidenceTranslation,
          sourceFactElements: {},
        },
      ],
      contradictionDetected: false,
      contradictionNote: "",
    };

    const verification = verifyEvidenceAgainstSources(rawClaim, registeredSources);
    const status = determineStatus(rawClaim, verification, registeredSources);
    const record: VerifiedFact = {
      fact: entry.fact,
      category: entry.category,
      status,
      evidenceQuote: entry.evidenceQuote,
      evidenceTranslation: entry.evidenceTranslation,
    };

    if (status === "VERIFIED") verified.push(record);
    else if (status === "PARTIALLY_VERIFIED") partiallyVerified.push(record);
    else rejected.push({ fact: entry.fact, status });
  }

  log(
    "FACT CHECK",
    `Verified fact set — ${verified.length} vérifié(s), ${partiallyVerified.length} partiellement vérifié(s), ${rejected.length} écarté(s) avant rédaction`,
  );
  return { sourceLanguage, verified, partiallyVerified, rejected };
}

/** Nothing survived verification: there is no article to write from, only room to invent one. */
export function isEmpty(set: VerifiedFactSet): boolean {
  return set.verified.length === 0 && set.partiallyVerified.length === 0;
}

/** The writer's view of the fact set — verified facts plainly usable, partially-verified ones explicitly marked as requiring attributed, cautious phrasing. Rejected facts are absent by construction. */
export function formatForWriter(set: VerifiedFactSet): string {
  const lines: string[] = [];

  lines.push("FAITS VÉRIFIÉS — utilisables tels quels :");
  if (set.verified.length === 0) {
    lines.push("(aucun)");
  } else {
    for (const f of set.verified) {
      lines.push(`- [${f.category}] ${f.fact}`);
      lines.push(`  preuve source (${set.sourceLanguage || "langue inconnue"}) : « ${f.evidenceQuote} »`);
      if (f.evidenceTranslation) lines.push(`  traduction de travail : « ${f.evidenceTranslation} »`);
    }
  }

  lines.push("");
  lines.push("FAITS PARTIELLEMENT VÉRIFIÉS — une seule source secondaire : à attribuer explicitement à la source et à formuler avec prudence (« selon … », « la source indique … »), jamais à asserter comme un fait établi :");
  if (set.partiallyVerified.length === 0) {
    lines.push("(aucun)");
  } else {
    for (const f of set.partiallyVerified) {
      lines.push(`- [${f.category}] ${f.fact}`);
      lines.push(`  preuve source (${set.sourceLanguage || "langue inconnue"}) : « ${f.evidenceQuote} »`);
      if (f.evidenceTranslation) lines.push(`  traduction de travail : « ${f.evidenceTranslation} »`);
    }
  }

  return lines.join("\n");
}
