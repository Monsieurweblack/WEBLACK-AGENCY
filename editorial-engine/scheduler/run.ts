import type { SourceArticle } from "../sources/types.ts";
import { loadConfig } from "../config/env.ts";
import { checkDuplicate } from "../validation/dedupe.ts";
import { analyzeArticle } from "../intelligence/analyze.ts";
import { extractFacts } from "../extraction/facts.ts";
import { generateArticle } from "../generation/generateArticle.ts";
import { runQualityCheck } from "../validation/qualityCheck.ts";
import { createArticle, findArticleBySlug } from "../sanity/articles.ts";
import { insertRun } from "../database/db.ts";
import { log, logError } from "../logs/logger.ts";

export interface PipelineOptions {
  dryRun: boolean;
}

export type PipelineOutcome =
  | { status: "skipped-duplicate"; reason: string }
  | { status: "skipped-low-score"; score: number; threshold: number }
  | { status: "skipped-quality"; errors: string[] }
  | { status: "dry-run"; article: Awaited<ReturnType<typeof generateArticle>> }
  | { status: "draft"; documentId: string }
  | { status: "published"; documentId: string }
  | { status: "error"; error: string };

/**
 * One source article, start to finish. NEVER publishes directly unless
 * `EDITORIAL_MODE=publish` AND every threshold in Phase 14 is met — the
 * default posture for this project is draft-only, matching WEBLACK's
 * non-fabrication / human-review discipline for editorial content.
 */
export async function processArticle(source: SourceArticle, options: PipelineOptions): Promise<PipelineOutcome> {
  const config = loadConfig();
  try {
    const duplicate = await checkDuplicate(source);
    if (duplicate.isDuplicate) {
      log("FINAL STATUS", `IGNORÉ (doublon) — ${source.title} — ${duplicate.reason}`);
      insertRun({
        sourceUrl: source.url,
        sourceName: source.sourceName,
        sourceTitle: source.title,
        sourceHash: source.hash,
        status: "skipped-duplicate",
        error: duplicate.reason,
      });
      return { status: "skipped-duplicate", reason: duplicate.reason ?? "duplicate" };
    }

    const analysis = await analyzeArticle(source);
    if (analysis.score < 40) {
      log("FINAL STATUS", `IGNORÉ (score bas: ${analysis.score}) — ${source.title}`);
      insertRun({
        sourceUrl: source.url,
        sourceName: source.sourceName,
        sourceTitle: source.title,
        sourceHash: source.hash,
        editorialScore: analysis.score,
        status: "skipped-low-score",
      });
      return { status: "skipped-low-score", score: analysis.score, threshold: 40 };
    }

    const facts = await extractFacts(source);
    const article = await generateArticle(source, facts, analysis);
    const quality = runQualityCheck(article, facts);

    if (options.dryRun) {
      log("FINAL STATUS", `DRY-RUN OK — ${article.title} (score ${article.editorialScore}, qualité ${quality.pass ? "OK" : "ÉCHEC"})`);
      return { status: "dry-run", article };
    }

    if (!quality.pass) {
      log("FINAL STATUS", `IGNORÉ (contrôle qualité) — ${article.title} — ${quality.errors.join("; ")}`);
      insertRun({
        sourceUrl: source.url,
        sourceName: source.sourceName,
        sourceTitle: source.title,
        sourceHash: source.hash,
        generatedTitle: article.title,
        generatedSlug: article.slug,
        editorialScore: article.editorialScore,
        confidenceScore: article.confidenceScore,
        status: "error",
        error: `Quality check failed: ${quality.errors.join("; ")}`,
      });
      return { status: "skipped-quality", errors: quality.errors };
    }

    const existing = await findArticleBySlug(article.slug, article.lang);
    if (existing) {
      log("FINAL STATUS", `IGNORÉ (slug déjà utilisé dans Sanity: ${article.slug})`);
      return { status: "skipped-duplicate", reason: `Slug "${article.slug}" déjà utilisé` };
    }

    const shouldAutoPublish =
      config.mode === "publish" &&
      article.editorialScore >= config.autoPublishScore &&
      article.confidenceScore >= config.autoPublishConfidence &&
      quality.pass;

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
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
