import type { GeneratedArticle, VerifiedFactSet } from "../generation/types.ts";
import { structuredCompletion } from "../intelligence/openaiClient.ts";
import { extractComparableTokens, containsRelationMarker, stems } from "./equivalences.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

/**
 * What a published sentence actually is, relative to the Evidence Pack.
 *
 * The first four are legitimate: an article is supposed to restate its
 * facts in WEBLACK's own words, in French, with figures written the French
 * way, and to think about what they mean. The last two are not.
 */
export type ClaimVerdict =
  | "SUPPORTED_REFORMULATION"
  | "SUPPORTED_TRANSLATION"
  | "NORMALIZED_FACT"
  | "LEGITIMATE_ANALYSIS"
  | "UNSUPPORTED_DEDUCTION"
  | "TRUE_FABRICATION";

const ACCEPTED: ReadonlySet<ClaimVerdict> = new Set<ClaimVerdict>([
  "SUPPORTED_REFORMULATION",
  "SUPPORTED_TRANSLATION",
  "NORMALIZED_FACT",
  "LEGITIMATE_ANALYSIS",
]);

export interface Claim {
  claim: string;
  supported: boolean;
  sourceEvidence: string;
  confidence: number; // 0-100 — the model's confidence in its own call, never used to decide anything
  /** Verdict after programmatic confirmation — not the model's own answer where the two disagree. */
  verdict: ClaimVerdict;
  /** Set when the deterministic layer overruled the model, with the reason. */
  downgradedFrom?: ClaimVerdict;
  downgradeReason?: string;
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
          verdict: {
            type: "string",
            enum: ["SUPPORTED_REFORMULATION", "SUPPORTED_TRANSLATION", "NORMALIZED_FACT", "LEGITIMATE_ANALYSIS", "UNSUPPORTED_DEDUCTION", "TRUE_FABRICATION"],
          },
          sourceEvidence: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["claim", "verdict", "sourceEvidence", "confidence"],
      },
    },
  },
  required: ["claims"],
};

const SYSTEM_PROMPT = `Tu es un vérificateur de faits strict. On te donne un article et l'ENSEMBLE DES FAITS VÉRIFIÉS dont il est issu — cet ensemble est la seule référence : tout ce que tu sais par ailleurs, même exact, ne compte pas.

Décompose l'article en affirmations individuelles importantes (chaque chiffre, date, nom, fonction, événement, citation, relation de cause à effet). Pour CHAQUE affirmation, donne un verdict :

- "SUPPORTED_REFORMULATION" : le fait est dans les faits vérifiés, reformulé avec d'autres mots. C'est le cas normal et attendu — un article n'est pas censé recopier ses sources.
- "SUPPORTED_TRANSLATION" : le fait est dans les faits vérifiés, en anglais, et l'article l'énonce en français. Également normal.
- "NORMALIZED_FACT" : même fait, notation différente — « 496,000 » écrit « 496 000 », « 2 p.m. » écrit « 14 heures », « Spring/Summer 2026 » écrit « SS26 ».
- "LEGITIMATE_ANALYSIS" : une mise en perspective, un commentaire, une transition, qui n'avance AUCUN fait nouveau. Interdit si la phrase introduit un chiffre, une date, un nom ou une relation de cause à effet.
- "UNSUPPORTED_DEDUCTION" : le fait n'est pas énoncé tel quel, il est déduit. En particulier toute causalité, motivation, conséquence ou comparaison que les faits vérifiés n'énoncent pas eux-mêmes. « Elle a travaillé chez Fendi puis chez Dior » n'autorise pas « son passage chez Fendi l'a menée chez Dior ».
- "TRUE_FABRICATION" : l'affirmation ne correspond à rien dans les faits vérifiés.

- "sourceEvidence" : l'extrait EXACT des faits vérifiés sur lequel tu t'appuies (chaîne vide pour UNSUPPORTED_DEDUCTION et TRUE_FABRICATION).
- "confidence" : ta confiance dans ce verdict.

Vise une couverture complète de l'article, pas seulement une liste de fautes.`;

export interface AntiFabricationResult {
  pass: boolean;
  claims: Claim[];
  unsupportedClaims: Claim[];
  /** How many claims each verdict accounted for — the signal for telling a calibration problem from a real quality problem. */
  byVerdict: Record<ClaimVerdict, number>;
}

/**
 * Adversarial fact check over the finished article.
 *
 * Two things were making it the pipeline's main source of false rejections,
 * and both are fixed here.
 *
 * It used to be handed the RAW extraction, which still contains the facts
 * the pre-writing verification threw out — so a sentence could be waved
 * through on the strength of something that had already been rejected. It
 * now sees the Evidence Pack and nothing else.
 *
 * And its verdict used to be a boolean. Every reformulation, every
 * translation, every French thousands separator the model did not judge
 * "explicit" became an unsupported claim, and one of those was enough to
 * reject an article that was, in substance, correct. The verdict is now a
 * classification — but the model's answer is not taken on trust, because a
 * model asserting "this is a supported reformulation" is exactly the kind
 * of self-report this project refuses as evidence. Anything the model
 * classifies as legitimate is re-checked in code against the Evidence
 * Pack: every figure, date, time and season in the sentence must already
 * be there, and a sentence may not assert a causal or comparative relation
 * unless the evidence asserts one too. Whatever fails that check is
 * downgraded and blocks, whatever the model said.
 *
 * Negative verdicts are never second-guessed: if the model calls something
 * a fabrication, it blocks. Erring toward blocking is the safe direction.
 */
export async function checkAntiFabrication(article: GeneratedArticle, pack: VerifiedFactSet, runId: string): Promise<AntiFabricationResult> {
  log("FACT CHECK", `Contrôle anti-fabrication — ${article.title}`);
  const config = loadConfig();
  const articleText = article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : ""))
    .join("\n");

  const packFacts = [...pack.verified, ...pack.partiallyVerified];
  const packText = packFacts
    .map((f) => `- ${f.fact}\n  preuve : « ${f.evidenceQuote} »${f.evidenceTranslation ? `\n  traduction : « ${f.evidenceTranslation} »` : ""}`)
    .join("\n");

  const result = await structuredCompletion<{ claims: Omit<Claim, "supported">[] }>({
    system: SYSTEM_PROMPT,
    user: `FAITS VÉRIFIÉS (seule référence autorisée) :\n${packText}\n\nArticle à vérifier :\nTitre: ${article.title}\nExcerpt: ${article.excerpt}\n${articleText}`,
    schemaName: "anti_fabrication_check",
    schema: SCHEMA,
    model: config.modelFactcheck,
    step: "quality-control",
    runId,
  });

  const claims = result.claims.map((raw) => confirmVerdict(raw, packFacts));
  const unsupportedClaims = claims.filter((c) => !c.supported);
  const byVerdict = tally(claims);
  const pass = unsupportedClaims.length === 0;

  log(
    "FACT CHECK",
    `${pass ? "OK" : "ÉCHEC"} — ${claims.length} affirmation(s), ${unsupportedClaims.length} bloquante(s) — ${Object.entries(byVerdict)
      .filter(([, n]) => n > 0)
      .map(([v, n]) => `${v}:${n}`)
      .join(" ")}`,
  );
  return { pass, claims, unsupportedClaims, byVerdict };
}

/**
 * Confirms — or overrules — the model's verdict against the Evidence Pack,
 * in code. Exported because this, not the model's answer, is where the
 * decision is actually made, and it is what the tests exercise.
 */
export function confirmVerdict(raw: Omit<Claim, "supported">, packFacts: VerifiedFactSet["verified"]): Claim {
  const block = (verdict: ClaimVerdict, reason: string): Claim => ({
    ...raw,
    supported: false,
    verdict,
    downgradedFrom: raw.verdict === verdict ? undefined : raw.verdict,
    downgradeReason: raw.verdict === verdict ? undefined : reason,
  });

  // A negative call from the model is taken at face value — blocking is the safe direction.
  if (!ACCEPTED.has(raw.verdict)) return { ...raw, supported: false };

  const claimTokens = extractComparableTokens(raw.claim);
  const packTokens = new Set(packFacts.flatMap((f) => extractComparableTokens(`${f.fact} ${f.evidenceQuote} ${f.evidenceTranslation}`)));

  // No figure, date, time or season may appear that the Evidence Pack does not already carry.
  const invented = claimTokens.filter((t) => !packTokens.has(t));
  if (invented.length > 0) {
    return block("TRUE_FABRICATION", `données absentes des faits vérifiés : ${invented.join(", ")}`);
  }

  // A relation has to be stated by the evidence, not inferred on top of it.
  if (containsRelationMarker(raw.claim)) {
    const evidenceStatesRelation = packFacts.some(
      (f) => containsRelationMarker(`${f.fact} ${f.evidenceQuote} ${f.evidenceTranslation}`) && sharesSubject(raw.claim, f),
    );
    if (!evidenceStatesRelation) {
      return block("UNSUPPORTED_DEDUCTION", "introduit une relation (causalité, motivation, conséquence ou comparaison) absente des preuves");
    }
  }

  // Commentary earns its name only by carrying no facts at all.
  if (raw.verdict === "LEGITIMATE_ANALYSIS" && claimTokens.length > 0) {
    return block("UNSUPPORTED_DEDUCTION", "présentée comme une analyse mais avance une donnée chiffrée");
  }

  return { ...raw, supported: true };
}

function sharesSubject(claim: string, fact: VerifiedFactSet["verified"][number]): boolean {
  const claimStems = new Set(stems(claim));
  return stems(`${fact.fact} ${fact.evidenceQuote} ${fact.evidenceTranslation}`).filter((s) => claimStems.has(s)).length >= 2;
}

export function emptyVerdictTally(): Record<ClaimVerdict, number> {
  return {
    SUPPORTED_REFORMULATION: 0,
    SUPPORTED_TRANSLATION: 0,
    NORMALIZED_FACT: 0,
    LEGITIMATE_ANALYSIS: 0,
    UNSUPPORTED_DEDUCTION: 0,
    TRUE_FABRICATION: 0,
  };
}

function tally(claims: Claim[]): Record<ClaimVerdict, number> {
  const counts = emptyVerdictTally();
  for (const c of claims) counts[c.verdict]++;
  return counts;
}
