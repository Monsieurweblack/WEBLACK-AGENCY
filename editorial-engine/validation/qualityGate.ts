import type { QualityCheckResult } from "./qualityCheck.ts";
import type { AntiCopyResult } from "./antiCopy.ts";
import type { AntiFabricationResult } from "./antiFabrication.ts";
import type { ClaimRegistryResult } from "./claimRegistry.ts";
import type { DuplicateDecision } from "./dedupe.ts";
import { isBlockingDecision } from "./dedupe.ts";
import { checkSeoTitle, checkSeoDescription } from "../seo/seo.ts";
import type { GeneratedArticle } from "../generation/types.ts";
import { log } from "../logs/logger.ts";

export type GateResult = "pass" | "fail";
export type FinalDecision = "publish" | "draft" | "reject";

/** §7 — the single structured object every check ultimately feeds. One failing critical gate is enough to prevent publication, exactly as specified — SEO issues alone never block (warnings only, matches §10 of the QA brief: "le SEO ne doit jamais détériorer la qualité éditoriale" by never being a publish-blocking gate on its own). */
export interface QualityGate {
  factCheck: GateResult;
  copyCheck: GateResult;
  editorialCheck: GateResult;
  seoCheck: GateResult;
  schemaCheck: GateResult;
  duplicateCheck: GateResult;
  finalDecision: FinalDecision;
  reasons: string[];
}

export interface QualityGateInputs {
  article: GeneratedArticle;
  quality: QualityCheckResult;
  antiCopy: AntiCopyResult;
  antiFabrication: AntiFabricationResult;
  /** The FINAL FACT-CHECK PASS (§ hardening phase) — source-traceable claim registry with programmatically-verified evidence. This is now the primary fact-check signal; antiFabrication stays as a second, independent, cheaper check run earlier in the pipeline (defense in depth — see the real Test A finding where antiFabrication alone missed a fabrication that a different check caught). */
  claimRegistry: ClaimRegistryResult;
  duplicate: DuplicateDecision;
  /** Whether every threshold for auto-publish is otherwise met (score/confidence) — the gate still needs every check to pass regardless. */
  eligibleForAutoPublish: boolean;
}

export function evaluateQualityGate(inputs: QualityGateInputs): QualityGate {
  const reasons: string[] = [];

  const factCheck: GateResult = inputs.antiFabrication.pass && inputs.claimRegistry.pass ? "pass" : "fail";
  if (!inputs.antiFabrication.pass) reasons.push(`Fact-check (antiFabrication): ${inputs.antiFabrication.unsupportedClaims.length} affirmation(s) non supportée(s)`);
  if (!inputs.claimRegistry.pass) {
    reasons.push(
      `FACT-CHECK FAIL: ${inputs.claimRegistry.blockingClaims.length} claim(s) critique(s) non vérifiable(s) ou contredit(s): ${inputs.claimRegistry.blockingClaims.map((c) => `"${c.claim}" (${c.verificationStatus})`).join("; ")}`,
    );
  }

  const copyCheck: GateResult = inputs.antiCopy.pass ? "pass" : "fail";
  if (copyCheck === "fail") reasons.push(`Anti-copie: copyRiskScore=${inputs.antiCopy.copyRiskScore}`);

  const editorialCheck: GateResult = inputs.quality.pass ? "pass" : "fail";
  if (editorialCheck === "fail") reasons.push(...inputs.quality.errors.map((e) => `Éditorial: ${e}`));

  const seoTitleCheck = checkSeoTitle(inputs.article.seo?.title ?? "");
  const seoDescCheck = checkSeoDescription(inputs.article.seo?.description ?? "");
  const seoIssues = [...seoTitleCheck.issues, ...seoDescCheck.issues];
  // SEO is never a hard gate — warnings only, per the brief's own "le SEO ne doit jamais détériorer la qualité éditoriale".
  const seoCheck: GateResult = "pass";
  if (seoIssues.length > 0) reasons.push(...seoIssues.map((i) => `SEO (avertissement, non bloquant): ${i}`));

  const schemaIssues: string[] = [];
  if (!inputs.article.slug) schemaIssues.push("slug manquant");
  if (!inputs.article.author) schemaIssues.push("author manquant");
  if (!inputs.article.title) schemaIssues.push("title manquant");
  if (inputs.article.body.length === 0) schemaIssues.push("body vide");
  const schemaCheck: GateResult = schemaIssues.length === 0 ? "pass" : "fail";
  if (schemaCheck === "fail") reasons.push(...schemaIssues.map((i) => `Schema: ${i}`));

  const duplicateCheck: GateResult = isBlockingDecision(inputs.duplicate.decision) ? "fail" : "pass";
  if (duplicateCheck === "fail") reasons.push(`Dédoublonnage: ${inputs.duplicate.decision} — ${inputs.duplicate.reason}`);

  const allCriticalPass = factCheck === "pass" && copyCheck === "pass" && editorialCheck === "pass" && schemaCheck === "pass" && duplicateCheck === "pass";

  let finalDecision: FinalDecision;
  if (!allCriticalPass) {
    finalDecision = "reject";
  } else if (inputs.eligibleForAutoPublish) {
    finalDecision = "publish";
  } else {
    finalDecision = "draft";
  }

  const gate: QualityGate = { factCheck, copyCheck, editorialCheck, seoCheck, schemaCheck, duplicateCheck, finalDecision, reasons };
  log("QUALITY CHECK", `Quality Gate: ${JSON.stringify({ ...gate, reasons: undefined })}`);
  return gate;
}
