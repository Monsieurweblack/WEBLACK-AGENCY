import type { SourceArticle } from "../sources/types.ts";
import type { GeneratedArticle, ExtractedFacts, EditorialAnalysis } from "../generation/types.ts";
import { JOURNAL_CATEGORIES } from "../generation/types.ts";
import { loadConfig } from "../config/env.ts";
import { checkDuplicate, isBlockingDecision, type DuplicateDecision } from "../validation/dedupe.ts";
import { analyzeArticle } from "../intelligence/analyze.ts";
import { extractFacts } from "../extraction/facts.ts";
import { generateArticle } from "../generation/generateArticle.ts";
import { runQualityCheck, type QualityCheckResult } from "../validation/qualityCheck.ts";
import { checkAntiCopy, type AntiCopyResult } from "../validation/antiCopy.ts";
import { checkAntiFabrication, type AntiFabricationResult } from "../validation/antiFabrication.ts";
import { evaluateQualityGate, type QualityGate } from "../validation/qualityGate.ts";
import { createArticle, findArticleBySlug } from "../sanity/articles.ts";
import { insertRun } from "../database/db.ts";
import { recordTestResult } from "../database/testResults.ts";
import { newRunId } from "../logs/runId.ts";
import { log, logError } from "../logs/logger.ts";
import { computeSeoOpportunity, type SeoOpportunity } from "../seo/opportunityEngine.ts";
import { classifyNewsworthiness, type NewsworthinessResult } from "../seo/newsworthiness.ts";
import { buildKeywordStrategy } from "../intelligence/keywordStrategy.ts";
import type { KeywordStrategy } from "../intelligence/keywordStrategy.ts";
import { suggestInternalLinks, type InternalLinkSuggestion } from "../seo/internalLinking.ts";
import { evaluateSeoQualityGate, type SeoQualityGateResult } from "../seo/seoQualityGate.ts";
import { combinePriority, type CombinedPriority } from "../seo/priority.ts";

export interface PipelineOptions {
  dryRun: boolean;
  /** Optional label so a test run (Test A, Test B, ...) is traceable in editorial-engine/test-results/. */
  testLabel?: string;
}

/** §9 — the full structured dry-run report: every stage's output, not just the final verdict, so a human reviewing a dry-run can see exactly why the engine landed on its decision. */
export interface DryRunReport {
  source: SourceArticle;
  duplicate: DuplicateDecision;
  analysis?: EditorialAnalysis;
  facts?: ExtractedFacts;
  article?: GeneratedArticle;
  quality?: QualityCheckResult;
  antiCopy?: AntiCopyResult;
  antiFabrication?: AntiFabricationResult;
  qualityGate?: QualityGate;
  seoOpportunity?: SeoOpportunity;
  newsworthiness?: NewsworthinessResult;
  keywordStrategy?: KeywordStrategy;
  internalLinks?: InternalLinkSuggestion[];
  seoQualityGate?: SeoQualityGateResult;
  priority?: CombinedPriority;
}

export type PipelineOutcome =
  | { status: "skipped-duplicate"; reason: string; report: DryRunReport }
  | { status: "skipped-low-score"; score: number; threshold: number; report: DryRunReport }
  | { status: "needs-review"; reason: string; report: DryRunReport }
  | { status: "dry-run"; report: DryRunReport }
  | { status: "draft"; documentId: string; report: DryRunReport }
  | { status: "published"; documentId: string; report: DryRunReport }
  | { status: "error"; error: string; report: DryRunReport };

function isKnownCategory(category: string): boolean {
  return (JOURNAL_CATEGORIES as readonly string[]).includes(category);
}

/**
 * One source article, start to finish, fully traced with one run_id (§10).
 * §11 cost control: checkDuplicate's Levels 1-3 run BEFORE any OpenAI call
 * and short-circuit exact/semantic duplicates for free; Level 5's single
 * classification call (only for the genuinely ambiguous band) is the only
 * dedup-related spend. Nothing is ever written to Sanity in dry-run mode,
 * on a needs-review outcome, or when the quality gate's finalDecision is
 * "reject".
 */
export async function processArticle(source: SourceArticle, options: PipelineOptions): Promise<PipelineOutcome> {
  const config = loadConfig();
  const runId = newRunId();
  const report: DryRunReport = { source, duplicate: { decision: "new_story", confidence: 0, reason: "", matchedArticleId: null, needsReview: false, signals: {} } };

  try {
    const duplicate = await checkDuplicate(source, runId);
    report.duplicate = duplicate;

    if (isBlockingDecision(duplicate.decision)) {
      log("FINAL STATUS", `IGNORÉ (${duplicate.decision}) — ${source.title} — ${duplicate.reason}`);
      persist(source, options, "skipped-duplicate", report, { reason: duplicate.reason });
      return { status: "skipped-duplicate", reason: duplicate.reason, report };
    }
    if (duplicate.needsReview && options.dryRun === false) {
      // In dry-run this still proceeds through the rest of the pipeline (§9: the report should show the full picture) — only a REAL run stops here to avoid spending on generation for a case a human should look at first.
      log("FINAL STATUS", `REVIEW (dédoublonnage: ${duplicate.decision}) — ${source.title} — ${duplicate.reason}`);
      persist(source, options, "needs-review", report, { reason: duplicate.reason });
      return { status: "needs-review", reason: duplicate.reason, report };
    }

    const analysis = await analyzeArticle(source, runId);
    report.analysis = analysis;

    // Pure, local — no OpenAI cost — computed as soon as the analysis exists, independently of whether the article ends up generated.
    const seoOpportunity = computeSeoOpportunity(source, analysis);
    report.seoOpportunity = seoOpportunity;
    const newsworthiness = classifyNewsworthiness(source, analysis);
    report.newsworthiness = newsworthiness;
    report.priority = combinePriority(analysis.score, seoOpportunity.seoOpportunityScore, newsworthiness.newsworthinessScore);

    if (analysis.score < 40) {
      log("FINAL STATUS", `IGNORÉ (score bas: ${analysis.score}) — ${source.title}`);
      persist(source, options, "skipped-low-score", report, { editorialScore: analysis.score });
      return { status: "skipped-low-score", score: analysis.score, threshold: 40, report };
    }
    if (!isKnownCategory(analysis.category)) {
      log("FINAL STATUS", `REVIEW (catégorie incertaine: "${analysis.category}") — ${source.title}`);
      persist(source, options, "needs-review", report, { reason: `Catégorie hors liste: ${analysis.category}` });
      return { status: "needs-review", reason: `Catégorie retournée par le modèle hors liste autorisée: "${analysis.category}"`, report };
    }

    const facts = await extractFacts(source, runId);
    report.facts = facts;
    const article = await generateArticle(source, facts, analysis, runId);
    report.article = article;

    const quality = runQualityCheck(article, facts);
    report.quality = quality;
    const antiCopy = checkAntiCopy(article, source);
    report.antiCopy = antiCopy;
    const antiFabrication = await checkAntiFabrication(article, facts, runId);
    report.antiFabrication = antiFabrication;

    const keywordStrategy = await buildKeywordStrategy(source, facts, analysis, runId);
    report.keywordStrategy = keywordStrategy;
    const internalLinks = await suggestInternalLinks(article, keywordStrategy);
    report.internalLinks = internalLinks;
    report.seoQualityGate = evaluateSeoQualityGate(article, keywordStrategy, internalLinks);

    const eligibleForAutoPublish =
      config.mode === "publish" && article.editorialScore >= config.autoPublishScore && article.confidenceScore >= config.autoPublishConfidence;
    const gate = evaluateQualityGate({ article, quality, antiCopy, antiFabrication, duplicate, eligibleForAutoPublish });
    report.qualityGate = gate;

    if (options.dryRun) {
      log("FINAL STATUS", `DRY-RUN — ${article.title} — Quality Gate: ${gate.finalDecision}`);
      persist(source, options, "dry-run", report, {});
      return { status: "dry-run", report };
    }

    if (gate.finalDecision === "reject") {
      log("FINAL STATUS", `NEEDS-REVIEW (Quality Gate: reject) — ${article.title} — ${gate.reasons.join("; ")}`);
      persist(source, options, "needs-review", report, { reason: gate.reasons.join("; ") });
      return { status: "needs-review", reason: gate.reasons.join("; "), report };
    }

    const existing = await findArticleBySlug(article.slug, article.lang);
    if (existing) {
      log("FINAL STATUS", `IGNORÉ (slug déjà utilisé dans Sanity: ${article.slug})`);
      persist(source, options, "skipped-duplicate", report, { reason: `Slug déjà utilisé: ${article.slug}` });
      return { status: "skipped-duplicate", reason: `Slug "${article.slug}" déjà utilisé`, report };
    }

    const { documentId } = await createArticle(article, { asDraft: gate.finalDecision !== "publish" });

    insertRun({
      sourceUrl: source.url,
      sourceName: source.sourceName,
      sourceTitle: source.title,
      sourceHash: source.hash,
      canonicalUrl: source.canonicalUrl,
      contentHash: source.contentHash,
      lang: article.lang,
      generatedTitle: article.title,
      generatedSlug: article.slug,
      editorialScore: article.editorialScore,
      confidenceScore: article.confidenceScore,
      status: gate.finalDecision === "publish" ? "published" : "draft",
      sanityDocumentId: documentId,
    });
    recordTestResult({ source, options, checks: reportToChecks(report), article, status: gate.finalDecision === "publish" ? "published" : "draft", sanityDocumentId: documentId });

    log("FINAL STATUS", `${gate.finalDecision === "publish" ? "PUBLIÉ" : "BROUILLON"} — ${article.title} (${documentId})`);
    return gate.finalDecision === "publish" ? { status: "published", documentId, report } : { status: "draft", documentId, report };
  } catch (error) {
    logError("ERROR", error, { source: source.sourceName, recommendedAction: "Vérifier les logs, relancer avec editorial:dry-run" });
    insertRun({
      sourceUrl: source.url,
      sourceName: source.sourceName,
      sourceTitle: source.title,
      sourceHash: source.hash,
      canonicalUrl: source.canonicalUrl,
      contentHash: source.contentHash,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    recordTestResult({ source, options, checks: reportToChecks(report), status: "error", error: error instanceof Error ? error.message : String(error) });
    return { status: "error", error: error instanceof Error ? error.message : String(error), report };
  }
}

function reportToChecks(report: DryRunReport): Record<string, unknown> {
  return {
    duplicate: report.duplicate,
    analysis: report.analysis,
    facts: report.facts,
    quality: report.quality,
    antiCopy: report.antiCopy,
    antiFabrication: report.antiFabrication,
    qualityGate: report.qualityGate,
    seoOpportunity: report.seoOpportunity,
    newsworthiness: report.newsworthiness,
    keywordStrategy: report.keywordStrategy,
    internalLinks: report.internalLinks,
    seoQualityGate: report.seoQualityGate,
    priority: report.priority,
  };
}

function persist(
  source: SourceArticle,
  options: PipelineOptions,
  status: "skipped-duplicate" | "skipped-low-score" | "needs-review" | "dry-run",
  report: DryRunReport,
  extra: { reason?: string; editorialScore?: number },
): void {
  if (status !== "dry-run") {
    insertRun({
      sourceUrl: source.url,
      sourceName: source.sourceName,
      sourceTitle: source.title,
      sourceHash: source.hash,
      canonicalUrl: source.canonicalUrl,
      contentHash: source.contentHash,
      editorialScore: extra.editorialScore,
      status: status === "needs-review" ? "error" : status, // DB enum has no needs-review column; test-results/ carries the real status
      error: status === "needs-review" ? `NEEDS-REVIEW: ${extra.reason}` : extra.reason,
    });
  }
  recordTestResult({ source, options, checks: reportToChecks(report), status, article: report.article, reason: extra.reason });
}

export type { GeneratedArticle, ExtractedFacts, EditorialAnalysis };
