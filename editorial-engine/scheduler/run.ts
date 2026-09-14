import type { SourceArticle } from "../sources/types.ts";
import type { GeneratedArticle, ExtractedFacts, EditorialAnalysis } from "../generation/types.ts";
import { JOURNAL_CATEGORIES } from "../generation/types.ts";
import { loadConfig } from "../config/env.ts";
import { checkDuplicate } from "../validation/dedupe.ts";
import { analyzeArticle } from "../intelligence/analyze.ts";
import { extractFacts } from "../extraction/facts.ts";
import { generateArticle } from "../generation/generateArticle.ts";
import { runQualityCheck } from "../validation/qualityCheck.ts";
import { checkAntiCopy } from "../validation/antiCopy.ts";
import { checkAntiFabrication } from "../validation/antiFabrication.ts";
import { createArticle, findArticleBySlug } from "../sanity/articles.ts";
import { insertRun } from "../database/db.ts";
import { recordTestResult } from "../database/testResults.ts";
import { log, logError } from "../logs/logger.ts";

export interface PipelineOptions {
  dryRun: boolean;
  /** Optional label so a test run (Test A, Test B, ...) is traceable in editorial-engine/test-results/. */
  testLabel?: string;
}

export type PipelineOutcome =
  | { status: "skipped-duplicate"; reason: string }
  | { status: "skipped-low-score"; score: number; threshold: number }
  | { status: "skipped-quality"; errors: string[] }
  | { status: "needs-review"; reason: string; details?: unknown }
  | { status: "dry-run"; article: GeneratedArticle; checks: Record<string, unknown> }
  | { status: "draft"; documentId: string }
  | { status: "published"; documentId: string }
  | { status: "error"; error: string };

/**
 * One source article, start to finish. NEVER publishes directly unless
 * `EDITORIAL_MODE=publish` AND every threshold in Phase 14 is met, and
 * never writes ANYTHING to Sanity in dry-run mode or when any check
 * produces an ambiguous/failing result — those cases stop at
 * `needs-review` instead of guessing.
 */
export async function processArticle(source: SourceArticle, options: PipelineOptions): Promise<PipelineOutcome> {
  const config = loadConfig();
  const checks: Record<string, unknown> = {};
  try {
    const duplicate = await checkDuplicate(source);
    checks.duplicate = duplicate;
    if (duplicate.isDuplicate) {
      log("FINAL STATUS", `IGNORÉ (doublon) — ${source.title} — ${duplicate.reason}`);
      recordRunAndTest(source, options, "skipped-duplicate", { checks, reason: duplicate.reason });
      return { status: "skipped-duplicate", reason: duplicate.reason ?? "duplicate" };
    }
    if (duplicate.needsReview) {
      log("FINAL STATUS", `REVIEW (dédoublonnage ambigu) — ${source.title} — ${duplicate.reason}`);
      recordRunAndTest(source, options, "needs-review", { checks, reason: duplicate.reason });
      return { status: "needs-review", reason: duplicate.reason ?? "Dédoublonnage ambigu", details: duplicate };
    }

    const analysis = await analyzeArticle(source);
    checks.analysis = analysis;
    if (analysis.score < 40) {
      log("FINAL STATUS", `IGNORÉ (score bas: ${analysis.score}) — ${source.title}`);
      recordRunAndTest(source, options, "skipped-low-score", { checks, editorialScore: analysis.score });
      return { status: "skipped-low-score", score: analysis.score, threshold: 40 };
    }
    if (!isKnownCategory(analysis.category)) {
      log("FINAL STATUS", `REVIEW (catégorie incertaine: "${analysis.category}") — ${source.title}`);
      recordRunAndTest(source, options, "needs-review", { checks, reason: `Catégorie hors liste: ${analysis.category}` });
      return { status: "needs-review", reason: `Catégorie retournée par le modèle hors liste autorisée: "${analysis.category}"` };
    }

    const facts = await extractFacts(source);
    checks.facts = facts;
    const article = await generateArticle(source, facts, analysis);

    const quality = runQualityCheck(article, facts);
    checks.quality = quality;
    const antiCopy = checkAntiCopy(article, source);
    checks.antiCopy = antiCopy;
    const antiFabrication = await checkAntiFabrication(article, facts);
    checks.antiFabrication = antiFabrication;

    if (options.dryRun) {
      const summary = `qualité ${quality.pass ? "OK" : "ÉCHEC"}, anti-copie ${antiCopy.pass ? "OK" : "ÉCHEC"} (${(antiCopy.overlapRatio * 100).toFixed(1)}%), anti-fabrication ${antiFabrication.pass ? "OK" : "ÉCHEC"}`;
      log("FINAL STATUS", `DRY-RUN — ${article.title} (score ${article.editorialScore}, ${summary})`);
      recordRunAndTest(source, options, "dry-run", { checks, article });
      return { status: "dry-run", article, checks };
    }

    if (!quality.pass || !antiCopy.pass || !antiFabrication.pass) {
      const errors = [
        ...quality.errors,
        ...(antiCopy.pass ? [] : [`Anti-copie: recouvrement ${(antiCopy.overlapRatio * 100).toFixed(1)}% avec la source (seuil dépassé)`]),
        ...antiFabrication.unsupportedClaims.map((c) => `Anti-fabrication: "${c.claim}" — ${c.reason}`),
      ];
      log("FINAL STATUS", `NEEDS-REVIEW (contrôles) — ${article.title} — ${errors.join("; ")}`);
      recordRunAndTest(source, options, "needs-review", { checks, article, reason: errors.join("; ") });
      return { status: "needs-review", reason: errors.join("; "), details: { quality, antiCopy, antiFabrication } };
    }

    const existing = await findArticleBySlug(article.slug, article.lang);
    if (existing) {
      log("FINAL STATUS", `IGNORÉ (slug déjà utilisé dans Sanity: ${article.slug})`);
      recordRunAndTest(source, options, "skipped-duplicate", { checks, reason: `Slug déjà utilisé: ${article.slug}` });
      return { status: "skipped-duplicate", reason: `Slug "${article.slug}" déjà utilisé` };
    }

    const shouldAutoPublish =
      config.mode === "publish" &&
      article.editorialScore >= config.autoPublishScore &&
      article.confidenceScore >= config.autoPublishConfidence &&
      quality.pass &&
      antiCopy.pass &&
      antiFabrication.pass;

    const { documentId } = await createArticle(article, { asDraft: !shouldAutoPublish });

    insertRun({
      sourceUrl: source.url,
      sourceName: source.sourceName,
      sourceTitle: source.title,
      sourceHash: source.hash,
      lang: article.lang,
      generatedTitle: article.title,
      generatedSlug: article.slug,
      editorialScore: article.editorialScore,
      confidenceScore: article.confidenceScore,
      status: shouldAutoPublish ? "published" : "draft",
      sanityDocumentId: documentId,
    });
    recordTestResult({ source, options, checks, article, status: shouldAutoPublish ? "published" : "draft", sanityDocumentId: documentId });

    log("FINAL STATUS", `${shouldAutoPublish ? "PUBLIÉ" : "BROUILLON"} — ${article.title} (${documentId})`);
    return shouldAutoPublish ? { status: "published", documentId } : { status: "draft", documentId };
  } catch (error) {
    logError("ERROR", error, { source: source.sourceName, recommendedAction: "Vérifier les logs, relancer avec editorial:dry-run" });
    insertRun({
      sourceUrl: source.url,
      sourceName: source.sourceName,
      sourceTitle: source.title,
      sourceHash: source.hash,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    recordTestResult({ source, options, checks, status: "error", error: error instanceof Error ? error.message : String(error) });
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

function isKnownCategory(category: string): boolean {
  return (JOURNAL_CATEGORIES as readonly string[]).includes(category);
}

function recordRunAndTest(
  source: SourceArticle,
  options: PipelineOptions,
  status: "skipped-duplicate" | "skipped-low-score" | "needs-review" | "dry-run",
  extra: { checks: Record<string, unknown>; reason?: string; editorialScore?: number; article?: GeneratedArticle },
): void {
  if (status !== "dry-run") {
    insertRun({
      sourceUrl: source.url,
      sourceName: source.sourceName,
      sourceTitle: source.title,
      sourceHash: source.hash,
      editorialScore: extra.editorialScore,
      status: status === "needs-review" ? "error" : status, // DB enum has no needs-review column; error+message keeps it queryable, test-results/ carries the real status
      error: status === "needs-review" ? `NEEDS-REVIEW: ${extra.reason}` : extra.reason,
    });
  }
  recordTestResult({ source, options, checks: extra.checks, status, article: extra.article, reason: extra.reason });
}

export type { GeneratedArticle, ExtractedFacts, EditorialAnalysis };
