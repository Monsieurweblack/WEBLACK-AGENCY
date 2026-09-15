import { enabledSources } from "../sources/loadSources.ts";
import { fetchRssSource } from "../ingestion/rss.ts";
import { processArticle } from "./run.ts";
import { loadConfig } from "../config/env.ts";
import { acquireCycleLock, releaseCycleLock } from "./cycleLock.ts";
import { readLedger } from "../logs/productionLedger.ts";
import { runAgendaCycle } from "../agenda/runAgendaCycle.ts";
import { currentQueue } from "../newsletter/queue.ts";
import { log, logError } from "../logs/logger.ts";

/**
 * IMPORTANT: this is an in-process interval loop, not a system daemon or a
 * Cloudflare Pages Function — Cloudflare Pages has no persistent runtime to
 * host it (the site itself is a static build). Run this with a process
 * supervisor of your choice: `node --experimental-strip-types
 * editorial-engine/cli.ts run --watch` left running on a machine you
 * control (a small VPS, a Task Scheduler entry, a `pm2`/systemd unit), or
 * invoked on a schedule by an external cron (e.g. a scheduled GitHub
 * Action) instead of `--watch`. See EDITORIAL_ENGINE.md.
 */
/** Feeds are ordered newest-first, so taking the head of the list is taking the freshest items — which is also what the editorial brief asks to prioritise. */
const DEFAULT_MAX_ITEMS_PER_CYCLE = 5;

export async function runOneCycle(dryRun: boolean): Promise<void> {
  const sources = enabledSources();
  if (sources.length === 0) {
    log("SOURCE FOUND", "Aucune source activée dans editorial-engine/sources/sources.json — rien à faire.");
    return;
  }
  if (!acquireCycleLock()) return;
  // One id for the whole cycle, so the production ledger can show what a
  // single pass over every source produced, end to end.
  const startedAt = new Date().toISOString();
  const cycleId = `cycle-${startedAt.replace(/[:.]/g, "-")}`;
  log("SOURCE FOUND", `Cycle ${cycleId} — ${sources.length} source(s) activée(s)`);
  try {
    for (const source of sources) {
      if (source.type !== "rss") continue; // "manual" sources are only reachable via `editorial:url`
      try {
        const fetched = await fetchRssSource(source);
        const candidates = fetched.slice(0, source.maxItemsPerCycle ?? DEFAULT_MAX_ITEMS_PER_CYCLE);
        log("SOURCE FOUND", `${candidates.length} article(s) retenus sur ${fetched.length} — ${source.name}`);
        for (const candidate of candidates) {
          await processArticle(candidate, { dryRun, cycleId });
        }
      } catch (error) {
        logError("FETCH", error, { source: source.name, recommendedAction: "Vérifier l'URL du flux et sa disponibilité" });
      }
    }

    // Agenda culturel : à l'intérieur du même cycle, sous le verrou déjà
    // détenu — pas de second planificateur, pas de boucle concurrente. Un
    // échec de recherche web ne doit jamais faire tomber le cycle éditorial.
    try {
      await runAgendaCycle(dryRun);
    } catch (error) {
      logError("FETCH", error, { source: "agenda", recommendedAction: "Vérifier la disponibilité de la recherche web" });
    }
  } finally {
    releaseCycleLock();
  }
  logCycleSummary(cycleId, startedAt, sources.length);
}

/** One line per finished cycle, read back from the ledger the cycle itself wrote — no parallel accounting to drift out of sync. */
function logCycleSummary(cycleId: string, startedAt: string, sourceCount: number): void {
  const entries = readLedger().filter((e) => e.cycleId === cycleId);
  const count = (d: string) => entries.filter((e) => e.decision === d).length;
  const newsletters = currentQueue().filter((n) => entries.some((e) => e.runId === n.runId));

  const summary = {
    run_id: cycleId,
    start: startedAt,
    end: new Date().toISOString(),
    sources: sourceCount,
    analysed: entries.length,
    eligible: entries.filter((e) => e.stoppedAt !== "deduplication").length,
    generated: entries.filter((e) => e.article !== undefined).length,
    pass: count("PASS"),
    review: count("REVIEW"),
    reject: count("REJECT"),
    skip: entries.filter((e) => e.stoppedAt === "deduplication").length,
    published: count("PUBLISHED"),
    newsletterGenerated: newsletters.length,
    newsletterSent: newsletters.filter((n) => n.status === "sent").length,
    cost: {
      calls: entries.reduce((s, e) => s + e.cost.calls, 0),
      tokens: entries.reduce((s, e) => s + e.cost.totalTokens, 0),
      estimatedUsd: Number(entries.reduce((s, e) => s + e.cost.estimatedUsd, 0).toFixed(4)),
    },
    errors: entries.filter((e) => e.stoppedAt === "error").length,
  };
  log("FINAL STATUS", `Cycle terminé — ${JSON.stringify(summary)}`);
}

export async function watchLoop(): Promise<void> {
  const config = loadConfig();
  const intervalMs = config.intervalMinutes * 60_000;
  log("SOURCE FOUND", `Mode veille activé — cycle toutes les ${config.intervalMinutes} min. Ctrl+C pour arrêter.`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runOneCycle(false);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
