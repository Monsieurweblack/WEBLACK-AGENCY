import { recentRuns, type RunRecord } from "./db.ts";

export interface DashboardData {
  generatedAt: string;
  totals: {
    topicsDetected: number;
    topicsRejected: number;
    articlesDraft: number;
    articlesPublished: number;
    errors: number;
  };
  recentTopics: { title: string; url: string; status: string; editorialScore?: number; createdAt?: string }[];
  errorSummary: { sourceTitle: string; error: string }[];
}

/**
 * §20 — pulled entirely from the LOCAL run history this engine already
 * writes (database/db.ts) — no external analytics dependency, no invented
 * metric. A future dashboard UI reads this shape directly; this module has
 * no rendering concerns of its own.
 */
export function buildDashboardData(limit = 200): DashboardData {
  const runs = recentRuns(limit);

  const topicsDetected = runs.length;
  const topicsRejected = runs.filter((r) => r.status === "skipped-duplicate" || r.status === "skipped-low-score").length;
  const articlesDraft = runs.filter((r) => r.status === "draft").length;
  const articlesPublished = runs.filter((r) => r.status === "published").length;
  const errors = runs.filter((r) => r.status === "error").length;

  const recentTopics = runs.slice(0, 20).map((r: RunRecord) => ({
    title: r.generatedTitle ?? r.sourceTitle,
    url: r.sourceUrl,
    status: r.status,
    editorialScore: r.editorialScore,
    createdAt: r.createdAt,
  }));

  const errorSummary = runs
    .filter((r) => r.status === "error" && r.error)
    .slice(0, 20)
    .map((r) => ({ sourceTitle: r.sourceTitle, error: r.error! }));

  return {
    generatedAt: new Date().toISOString(),
    totals: { topicsDetected, topicsRejected, articlesDraft, articlesPublished, errors },
    recentTopics,
    errorSummary,
  };
}
