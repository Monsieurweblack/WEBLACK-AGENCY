import type { GeneratedArticle } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]+/g) ?? []
  );
}

function shingles(tokens: string[], n: number): Set<string> {
  if (tokens.length < n) return new Set();
  const result = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) result.add(tokens.slice(i, i + n).join(" "));
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) if (b.has(s)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** Longest run of consecutive words shared between the two token sequences — catches a single long copied passage even when it's a small fraction of a long generated article (a pure Jaccard-over-shingles score can hide one big lifted paragraph inside an otherwise original piece). */
function longestCommonRun(a: string[], b: string[]): number {
  const bIndex = new Map<string, number[]>();
  b.forEach((tok, i) => {
    if (!bIndex.has(tok)) bIndex.set(tok, []);
    bIndex.get(tok)!.push(i);
  });
  let best = 0;
  const prevRun = new Map<number, number>();
  for (let i = 0; i < a.length; i++) {
    const currRun = new Map<number, number>();
    for (const j of bIndex.get(a[i]!) ?? []) {
      const run = (prevRun.get(j - 1) ?? 0) + 1;
      currRun.set(j, run);
      if (run > best) best = run;
    }
    prevRun.clear();
    for (const [k, v] of currRun) prevRun.set(k, v);
  }
  return best;
}

function extractBodyText(article: GeneratedArticle): string {
  return article.body
    .filter((b) => b._type === "block")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join(" ") : ""))
    .join(" ");
}

export interface AntiCopyResult {
  copyRiskScore: number; // 0 (no risk) - 100 (very high risk)
  pass: boolean;
  lexicalOverlapRatio: number; // 8-word shingle Jaccard
  longestSharedRunWords: number;
  components: { lexical: number; structural: number };
}

/**
 * §4 — a single 0-100 copyRiskScore combining two signals rather than one
 * pass/fail threshold: lexical overlap (8-word shingle Jaccard, catches
 * scattered close paraphrasing) and a structural signal (longest run of
 * consecutive shared words, catches one long lifted passage that a
 * shingle-Jaccard average can dilute into looking safe). Configurable
 * block threshold via COPY_RISK_BLOCK_THRESHOLD (§4's "seuil configurable").
 */
export function checkAntiCopy(article: GeneratedArticle, source: SourceArticle): AntiCopyResult {
  const config = loadConfig();
  const sourceText = source.text ?? source.excerpt ?? "";
  const generatedText = extractBodyText(article);

  const sourceWords = words(sourceText);
  const generatedWords = words(generatedText);

  const lexicalOverlapRatio = jaccard(shingles(sourceWords, 8), shingles(generatedWords, 8));
  const longestSharedRunWords = longestCommonRun(generatedWords, sourceWords);

  // Lexical component: 15% shingle overlap already maps to 100 risk (a genuinely restructured article should be well under that — matches the previously-validated 15% pass/fail line, now expressed as a continuous score instead of a hard cutoff).
  const lexicalComponent = Math.min(100, (lexicalOverlapRatio / 0.15) * 100);
  // Structural component: a run of 20+ consecutive shared words (a full sentence lifted verbatim) maps to 100 risk regardless of how short the rest of the article's overlap is.
  const structuralComponent = Math.min(100, (longestSharedRunWords / 20) * 100);

  const copyRiskScore = Math.round(Math.max(lexicalComponent, structuralComponent));
  const pass = copyRiskScore <= config.copyRiskBlockThreshold;

  log(
    "QUALITY CHECK",
    `Anti-copie: copyRiskScore=${copyRiskScore} (lexical ${lexicalComponent.toFixed(0)}, structurel ${structuralComponent.toFixed(0)}, plus longue suite partagée: ${longestSharedRunWords} mots) — seuil ${config.copyRiskBlockThreshold} — ${pass ? "OK" : "BLOCK"}`,
  );

  return {
    copyRiskScore,
    pass,
    lexicalOverlapRatio,
    longestSharedRunWords,
    components: { lexical: Math.round(lexicalComponent), structural: Math.round(structuralComponent) },
  };
}
