import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";
import { readTraces } from "./observability.ts";

const LEDGER_FILE = path.join(ENGINE_ROOT, "logs", "production-ledger.jsonl");

/**
 * What the pipeline decided, in the three terms production actually acts on.
 * Deliberately NOT the same vocabulary as the internal run statuses: those
 * say where the pipeline stopped, this says what a human should do about it.
 */
export type ProductionDecision = "PASS" | "PUBLISHED" | "REVIEW" | "REJECT";

export interface LedgerEntry {
  runId: string;
  /** Groups every article of one production cycle under a single id. */
  cycleId: string;
  timestamp: string;
  durationMs: number;
  decision: ProductionDecision;
  /** Why, in one line — the gate reasons for a REJECT, the open question for a REVIEW. */
  reason?: string;
  stoppedAt: string;
  source: { name: string; url: string; canonicalUrl: string; title: string };
  article?: { title: string; slug: string; category: string };
  sanityDraftId?: string;
  scores?: {
    editorial?: number;
    confidence?: number;
    copyRisk?: number;
    seo?: number;
    newsworthiness?: number;
    seoOpportunity?: number;
  };
  /** Post-writing fact check: how each published claim resolved. */
  claims?: { total: number; verified: number; partiallyVerified: number; unverified: number; contradicted: number; blocking: number; recoveredFromPack: number };
  /** Pre-writing Evidence Pack: what the writer was allowed to work from, and what was dropped. */
  evidence?: { verified: number; partiallyVerified: number; droppedBeforeWriting: number };
  cost: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedUsd: number };
}

/**
 * Indicative only — OpenAI's published per-million rates for the default
 * model, applied to the token counts the API itself returned. It is a
 * running order-of-magnitude figure for operating the engine, never a
 * billing record: the invoice is authoritative, this is not.
 */
const RATES_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

function estimateUsd(model: string, promptTokens: number, completionTokens: number): number {
  const rate = RATES_PER_MILLION[model];
  if (!rate) return 0;
  return (promptTokens * rate.input + completionTokens * rate.output) / 1_000_000;
}

/** Aggregates every model call made under one run_id, straight from the trace file — no second accounting path to drift out of sync. */
export function costForRun(runId: string): LedgerEntry["cost"] {
  const traces = readTraces().filter((t) => t.runId === runId);
  let promptTokens = 0;
  let completionTokens = 0;
  let estimatedUsd = 0;
  for (const t of traces) {
    const prompt = t.tokenUsage?.promptTokens ?? 0;
    const completion = t.tokenUsage?.completionTokens ?? 0;
    promptTokens += prompt;
    completionTokens += completion;
    estimatedUsd += estimateUsd(t.model, prompt, completion);
  }
  return {
    calls: traces.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedUsd: Number(estimatedUsd.toFixed(5)),
  };
}

export function appendLedgerEntry(entry: LedgerEntry): void {
  fs.appendFileSync(LEDGER_FILE, JSON.stringify(entry) + "\n", "utf8");
}

export function readLedger(): LedgerEntry[] {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  return fs
    .readFileSync(LEDGER_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEntry);
}

/** Everything a human still has to look at: the REVIEW queue, newest first. */
export function reviewQueue(): LedgerEntry[] {
  return readLedger()
    .filter((e) => e.decision === "REVIEW")
    .reverse();
}
