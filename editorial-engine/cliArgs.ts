export interface ParsedArgs {
  dryRun: boolean;
  watch: boolean;
  testLabel: string | undefined;
  positional: string[];
}

/**
 * Pure so it's directly unit-testable (see tests/cliArgs.test.ts) — this is
 * exactly where a real bug slipped in during the SEO/news hardening pass:
 * when --label was absent, the old inline filter excluded index 0
 * unconditionally, silently dropping the first positional argument on
 * every call that didn't pass --label (surfaced by `editorial:freshness 0`
 * logging "seuil 90 jours" instead of 0).
 */
export function parseArgs(rest: string[]): ParsedArgs {
  const dryRun = rest.includes("--dry-run");
  const watch = rest.includes("--watch");
  const labelFlagIndex = rest.indexOf("--label");
  const testLabel = labelFlagIndex >= 0 ? rest[labelFlagIndex + 1] : undefined;
  const excludedIndices = new Set<number>(labelFlagIndex >= 0 ? [labelFlagIndex, labelFlagIndex + 1] : []);
  const positional = rest.filter((a, i) => !a.startsWith("--") && !excludedIndices.has(i));
  return { dryRun, watch, testLabel, positional };
}
