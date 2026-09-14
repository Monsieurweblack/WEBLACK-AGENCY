import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";
import type { SourceArticle } from "../sources/types.ts";
import type { GeneratedArticle } from "../generation/types.ts";

const RESULTS_DIR = path.join(ENGINE_ROOT, "test-results");
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

export interface RecordTestResultParams {
  source: SourceArticle;
  options: { dryRun: boolean; testLabel?: string };
  checks: Record<string, unknown>;
  status: string;
  article?: GeneratedArticle;
  reason?: string;
  errors?: string[];
  sanityDocumentId?: string;
  error?: string;
}

/**
 * Phase 16 — one file per test, human-readable, kept locally (never
 * committed with secrets: this only ever contains article text/scores, no
 * API keys or tokens). Written for EVERY outcome, not just successes, so a
 * failed/needs-review run is just as traceable as a published one.
 */
export function recordTestResult(params: RecordTestResultParams): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = params.options.testLabel ? `${params.options.testLabel}-` : "";
  const filename = `${timestamp}-${label}${slugForFilename(params.source.title)}.md`;
  const filePath = path.join(RESULTS_DIR, filename);

  const analysis = params.checks.analysis as { score?: number; category?: string; angle?: string; reasoning?: string } | undefined;
  const quality = params.checks.quality as { pass?: boolean; errors?: string[]; warnings?: string[] } | undefined;
  const antiCopy = params.checks.antiCopy as { pass?: boolean; overlapRatio?: number } | undefined;
  const antiFabrication = params.checks.antiFabrication as { pass?: boolean; unsupportedClaims?: { claim: string; reason: string }[] } | undefined;
  const duplicate = params.checks.duplicate as { verdict?: string; reason?: string; titleSimilarity?: number } | undefined;

  const bodyText = params.article
    ? params.article.body
        .filter((b) => b._type === "block")
        .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : `[image: ${(b as { alt?: string }).alt ?? ""}]`))
        .join("\n\n")
    : undefined;

  const problems: string[] = [
    ...(quality?.errors ?? []),
    ...(quality?.warnings ?? []).map((w) => `(avertissement) ${w}`),
    ...(antiCopy?.pass === false ? [`Anti-copie: recouvrement ${((antiCopy.overlapRatio ?? 0) * 100).toFixed(1)}%`] : []),
    ...((antiFabrication?.unsupportedClaims ?? []).map((c) => `Anti-fabrication: "${c.claim}" — ${c.reason}`)),
    ...(params.errors ?? []),
    ...(params.error ? [params.error] : []),
  ];

  const md = `# Test result — ${params.source.title}

- **Label** : ${params.options.testLabel ?? "(non étiqueté)"}
- **Source** : ${params.source.sourceName}
- **URL** : ${params.source.url}
- **Date** : ${new Date().toISOString()}
- **Décision finale** : ${params.status}
- **Dry-run** : ${params.options.dryRun ? "oui (rien écrit dans Sanity)" : "non"}
- **Document Sanity** : ${params.sanityDocumentId ?? "(aucun)"}

## Scores

- Score éditorial : ${analysis?.score ?? "N/A"}
- Catégorie retenue : ${analysis?.category ?? "N/A"}
- Angle : ${analysis?.angle ?? "N/A"}
- Contrôle qualité : ${quality?.pass === undefined ? "N/A" : quality.pass ? "PASS" : "FAIL"}
- Anti-copie (recouvrement avec la source) : ${antiCopy?.overlapRatio !== undefined ? `${(antiCopy.overlapRatio * 100).toFixed(1)}%` : "N/A"}
- Anti-fabrication : ${antiFabrication?.pass === undefined ? "N/A" : antiFabrication.pass ? "PASS" : "FAIL"}
- Dédoublonnage : ${duplicate?.verdict ?? "N/A"}${duplicate?.titleSimilarity !== undefined ? ` (similarité titre ${(duplicate.titleSimilarity * 100).toFixed(0)}%)` : ""}

## Problèmes détectés

${problems.length > 0 ? problems.map((p) => `- ${p}`).join("\n") : "(aucun)"}

## Raisonnement de l'analyse éditoriale

${analysis?.reasoning ?? "N/A"}

## Article généré

${params.article ? `**Titre** : ${params.article.title}\n\n**Excerpt** : ${params.article.excerpt}\n\n**Slug** : ${params.article.slug}\n\n${bodyText}` : "(aucun article généré à cette étape)"}

## Faits extraits (JSON)

\`\`\`json
${JSON.stringify(params.checks.facts ?? null, null, 2)}
\`\`\`
`;

  fs.writeFileSync(filePath, md, "utf8");
  return filePath;
}

function slugForFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
