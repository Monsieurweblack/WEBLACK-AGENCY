/**
 * Env loading for the editorial engine — a plain Node CLI tool, not part of
 * the Astro build. `import.meta.env` only exists inside Astro/Vite, so this
 * mirrors the same `.env`-reading pattern already used by
 * `scripts/content-integrity.mjs` rather than inventing a second one.
 *
 * This module never writes, never logs secret values, and never fabricates
 * a default for anything security-sensitive (API keys, tokens).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..", "..");
export const ENGINE_ROOT = path.resolve(__dirname, "..");

function loadDotEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && !line.trim().startsWith("#")) {
        const key = line.slice(0, i).trim();
        if (!(key in env)) env[key] = line.slice(i + 1).trim();
      }
    }
  }
  return env;
}

const raw = loadDotEnv();

export type EditorialMode = "draft" | "review" | "publish";

export interface EditorialConfig {
  sanityProjectId: string;
  sanityDataset: string;
  sanityWriteToken: string;
  openaiApiKey: string | undefined;
  mode: EditorialMode;
  autoPublishScore: number;
  autoPublishConfidence: number;
  intervalMinutes: number;
  defaultAuthor: string | undefined;
}

function requireVar(name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante: ${name}. Voir editorial-engine/.env.example et EDITORIAL_ENGINE.md.`,
    );
  }
  return value;
}

function parseMode(value: string | undefined): EditorialMode {
  if (value === "draft" || value === "review" || value === "publish") return value;
  return "draft"; // safe default — never auto-escalate publishing behavior
}

export function loadConfig(): EditorialConfig {
  return {
    sanityProjectId: requireVar("SANITY_PROJECT_ID"),
    sanityDataset: requireVar("SANITY_DATASET"),
    sanityWriteToken: requireVar("SANITY_WRITE_TOKEN"),
    openaiApiKey: raw.OPENAI_API_KEY || undefined,
    mode: parseMode(raw.EDITORIAL_MODE),
    autoPublishScore: Number(raw.AUTO_PUBLISH_SCORE ?? 90),
    autoPublishConfidence: Number(raw.AUTO_PUBLISH_CONFIDENCE ?? 90),
    intervalMinutes: Number(raw.EDITORIAL_INTERVAL_MINUTES ?? 60),
    defaultAuthor: raw.EDITORIAL_DEFAULT_AUTHOR || undefined,
  };
}
