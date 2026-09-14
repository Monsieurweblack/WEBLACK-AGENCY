import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";

const LOG_DIR = path.join(ENGINE_ROOT, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);

export type LogStep =
  | "SOURCE FOUND"
  | "FETCH"
  | "EXTRACT"
  | "DUPLICATE CHECK"
  | "EDITORIAL SCORE"
  | "FACT CHECK"
  | "GENERATION"
  | "SEO"
  | "QUALITY CHECK"
  | "SANITY"
  | "FINAL STATUS"
  | "ERROR";

export function log(step: LogStep, message: string): void {
  const line = `[${new Date().toISOString()}] [${step}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

export function logError(step: LogStep, error: unknown, context: { source?: string; attempt?: number; recommendedAction?: string } = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const line = [
    `[${new Date().toISOString()}] [ERROR] step=${step}`,
    context.source ? `source=${context.source}` : undefined,
    context.attempt !== undefined ? `attempt=${context.attempt}` : undefined,
    `error="${message}"`,
    context.recommendedAction ? `recommended="${context.recommendedAction}"` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  console.error(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}
