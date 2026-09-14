import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";

const TRACE_FILE = path.join(ENGINE_ROOT, "logs", `${new Date().toISOString().slice(0, 10)}-traces.jsonl`);

export interface TraceEvent {
  runId: string;
  sourceUrl?: string;
  model: string;
  step: "analysis" | "fact-extraction" | "generation" | "quality-control" | "dedup-classification";
  timestamp: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  /** OpenAI's own usage block when the SDK returns one — never includes the key or any header. */
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finalDecision?: string;
}

/**
 * §10 — one JSON line per OpenAI call, append-only, local file (gitignored
 * alongside the rest of editorial-engine/logs/). Deliberately a SEPARATE
 * file from logger.ts's human-readable log: this one is machine-parseable
 * and scoped strictly to model calls (run_id, step, latency, tokens),
 * never free-text messages that might accidentally embed something
 * sensitive. The API key itself never passes through this module — only
 * OpenAI SDK call metadata does.
 */
export function recordTrace(event: TraceEvent): void {
  fs.appendFileSync(TRACE_FILE, JSON.stringify(event) + "\n", "utf8");
}

export function readTraces(): TraceEvent[] {
  if (!fs.existsSync(TRACE_FILE)) return [];
  return fs
    .readFileSync(TRACE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}
