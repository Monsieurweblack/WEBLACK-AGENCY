import type { GeneratedArticle } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

export type ClaimType = "quote" | "statistic" | "date" | "name" | "role" | "event" | "general";
export type ClaimImportance = "critical" | "significant" | "minor";
export type VerificationStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "CONTRADICTED";

export interface RegisteredSource {
  source: SourceArticle;
  /** A first-party statement (the subject's own site, an official press release, a direct quote from the organization involved) — as opposed to third-party reporting. Never inferred automatically; set explicitly by whoever configured the source, defaults to false. */
  isPrimary?: boolean;
}

export interface ClaimSourceEvidence {
  sourceUrl: string;
  sourceName: string;
  /** Verbatim excerpt from that source's own text, confirmed programmatically (§ below) to actually appear in it — never text the LLM merely asserts exists. */
  evidence: string;
}

export interface RegisteredClaim {
  claim: string;
  type: ClaimType;
  importance: ClaimImportance;
  verificationStatus: VerificationStatus;
  confidence: number; // model's self-reported confidence — recorded for transparency, NEVER used to upgrade verificationStatus (see verifyRegistry below)
  sources: ClaimSourceEvidence[]; // only entries that passed the programmatic verbatim check
  reasoning: string;
}

export interface ClaimRegistryResult {
  claims: RegisteredClaim[];
  /** FACT-CHECK PASS/FAIL — false if any "critical" claim is UNVERIFIED or CONTRADICTED. */
  pass: boolean;
  blockingClaims: RegisteredClaim[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          type: { type: "string", enum: ["quote", "statistic", "date", "name", "role", "event", "general"] },
          importance: { type: "string", enum: ["critical", "significant", "minor"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          sourceEvidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                sourceIndex: { type: "integer" },
                // The model's claimed verbatim excerpt — trusted nowhere in this
                // module until verifyRegistry() below confirms it actually
                // appears in that source's real text.
                evidence: { type: "string" },
              },
              required: ["sourceIndex", "evidence"],
            },
          },
          contradictionDetected: { type: "boolean" },
          contradictionNote: { type: "string" },
        },
        required: ["claim", "type", "importance", "confidence", "sourceEvidence", "contradictionDetected", "contradictionNote"],
      },
    },
  },
  required: ["claims"],
};

/** Shape of one claim as returned by the model, before programmatic verification — exported so tests can exercise verifyEvidenceAgainstSources()/determineStatus() directly with fixtures, without paying for a real API call per scenario. */
export interface RawClaimForTesting {
  claim: string;
  type: ClaimType;
  importance: ClaimImportance;
  confidence: number;
  sourceEvidence: { sourceIndex: number; evidence: string }[];
  contradictionDetected: boolean;
  contradictionNote: string;
}
type RawClaim = RawClaimForTesting;

const SYSTEM_PROMPT = `Tu es un fact-checker indépendant. On te donne un article et une ou plusieurs sources numérotées. Décompose l'article en affirmations factuelles significatives (chiffres, dates, noms, fonctions, citations, événements) et pour CHACUNE :
- "type": quote (citation directe), statistic (chiffre), date, name (nom propre), role (fonction/titre), event, ou general.
- "importance": "critical" pour tout ce qui pourrait induire le lecteur en erreur si c'est faux (chiffres, citations, fonctions, causalité) ; "significant" pour le reste des faits vérifiables ; "minor" pour les détails d'ambiance.
- "sourceEvidence": pour CHAQUE source qui contient réellement cette information, indique son index (0-based, dans l'ordre fourni) et l'extrait EXACT, mot pour mot, de cette source qui la prouve. N'invente jamais un extrait — s'il n'y a pas de correspondance exacte dans une source, ne mentionne pas cette source pour ce claim. S'il n'y a AUCUNE source qui la prouve, "sourceEvidence" doit être un tableau vide.
- "contradictionDetected": true si deux sources ou plus se contredisent sur cette affirmation (ex: chiffres différents pour le même fait) — dans ce cas décris le désaccord dans "contradictionNote".

Règle absolue : ne jamais citer un extrait qui n'est pas mot pour mot dans la source — un extrait approximatif ou reformulé sera rejeté de toute façon par une vérification automatique indépendante de ta réponse.`;

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * §10 of the brief, operationalized: the model's own "supported"/"evidence"
 * claim is NEVER trusted on its word. This function is the actual proof —
 * every piece of evidence is checked here, in code, against the real
 * source text, before it counts for anything.
 */
export function verifyEvidenceAgainstSources(rawClaim: RawClaimForTesting, registeredSources: RegisteredSource[]): ClaimSourceEvidence[] {
  const verified: ClaimSourceEvidence[] = [];
  for (const match of rawClaim.sourceEvidence) {
    const entry = registeredSources[match.sourceIndex];
    if (!entry) continue;
    const sourceText = normalize(`${entry.source.title} ${entry.source.text ?? entry.source.excerpt ?? ""}`);
    const evidence = normalize(match.evidence);
    if (evidence.length >= 8 && sourceText.includes(evidence)) {
      verified.push({ sourceUrl: entry.source.url, sourceName: entry.source.sourceName, evidence: match.evidence });
    }
  }
  return verified;
}

/**
 * Determines verificationStatus from ONLY: (a) programmatically-verified
 * evidence count, (b) whether any backing source is marked primary, (c)
 * whether the model flagged a contradiction. `confidence` never enters this
 * decision — a confident model is not the same thing as a proven claim
 * (the brief's explicit "ne jamais transformer un score de confiance en
 * vérité").
 */
export function determineStatus(rawClaim: RawClaimForTesting, verifiedSources: ClaimSourceEvidence[], registeredSources: RegisteredSource[]): VerificationStatus {
  if (rawClaim.contradictionDetected) return "CONTRADICTED";

  // Quotes get zero tolerance (§5): a quote with no programmatically-confirmed verbatim source is unverified, full stop, regardless of confidence or importance.
  if (rawClaim.type === "quote" && verifiedSources.length === 0) return "UNVERIFIED";

  if (verifiedSources.length === 0) return "UNVERIFIED";

  const backedByPrimary = rawClaim.sourceEvidence.some((m) => registeredSources[m.sourceIndex]?.isPrimary && verifiedSources.some((v) => v.sourceUrl === registeredSources[m.sourceIndex]!.source.url));

  if (rawClaim.importance === "critical") {
    // §8: a single weak (non-primary) source is not enough for a sensitive/important fact.
    if (verifiedSources.length >= 2 || backedByPrimary) return "VERIFIED";
    return "PARTIALLY_VERIFIED";
  }

  return "VERIFIED";
}

/**
 * §6 pipeline step ("FINAL FACT-CHECK PASS"), run after generation. Accepts
 * multiple sources (registeredSources.length can be 1 or more) — the
 * verification logic itself is genuinely multi-source-capable and is
 * exercised that way in tests/claimRegistry.test.ts. The live pipeline
 * (scheduler/run.ts) currently calls this with a single source, since
 * ingestion only ever fetches one URL per run today; extending ingestion to
 * merge multiple URLs into one article is a separate, larger feature not
 * built in this phase.
 */
export async function buildClaimRegistry(article: GeneratedArticle, registeredSources: RegisteredSource[], runId: string): Promise<ClaimRegistryResult> {
  log("FACT CHECK", `Registre de claims (fact-check final) — ${article.title}`);
  const config = loadConfig();

  const articleText = article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : ""))
    .join("\n");

  const sourcesBlock = registeredSources
    .map((s, i) => `[Source ${i}] ${s.isPrimary ? "(PRIMAIRE) " : ""}${s.source.sourceName} — ${s.source.url}\n${s.source.text ?? s.source.excerpt ?? ""}`)
    .join("\n\n");

  const raw = await structuredCompletion<{ claims: RawClaim[] }>({
    system: SYSTEM_PROMPT,
    user: `Article:\nTitre: ${article.title}\nExcerpt: ${article.excerpt}\n${articleText}\n\n--- Sources ---\n${sourcesBlock}`,
    schemaName: "claim_registry",
    schema: SCHEMA,
    model: config.modelFactcheck,
    step: "quality-control",
    runId,
  });

  const claims: RegisteredClaim[] = raw.claims.map((rawClaim) => {
    const verifiedSources = verifyEvidenceAgainstSources(rawClaim, registeredSources);
    const verificationStatus = determineStatus(rawClaim, verifiedSources, registeredSources);
    return {
      claim: rawClaim.claim,
      type: rawClaim.type,
      importance: rawClaim.importance,
      verificationStatus,
      confidence: rawClaim.confidence,
      sources: verifiedSources,
      reasoning: rawClaim.contradictionDetected ? rawClaim.contradictionNote : verifiedSources.length > 0 ? "Preuve vérifiée mot pour mot dans la/les source(s)." : "Aucune preuve vérifiable trouvée dans les sources fournies.",
    };
  });

  const blockingClaims = claims.filter((c) => c.importance === "critical" && (c.verificationStatus === "UNVERIFIED" || c.verificationStatus === "CONTRADICTED"));

  const pass = blockingClaims.length === 0;
  log("FACT CHECK", `${pass ? "FACT-CHECK PASS" : "FACT-CHECK FAIL"} — ${claims.length} claim(s), ${blockingClaims.length} bloquant(s)`);
  return { claims, pass, blockingClaims };
}
