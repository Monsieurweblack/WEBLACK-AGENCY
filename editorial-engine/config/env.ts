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
  /** Per-task model selection (§11 cost control) — analysis and fact-check are classification-shaped tasks that don't need the same model as long-form writing. Each falls back to a shared default if unset, never hardcoded. */
  modelAnalysis: string;
  modelWriting: string;
  modelFactcheck: string;
  /** §4 anti-copy threshold, 0-100. Above it, the pipeline blocks the article. */
  copyRiskBlockThreshold: number;
  /** §12 Search Console readiness — both undefined until a real connection is configured; see intelligence/searchConsole.ts. */
  googleSearchConsoleCredentialsJson: string | undefined;
  googleSearchConsoleSiteUrl: string | undefined;
  /** Public site root, used to build the article link inside a newsletter. */
  siteUrl: string;
  /** How a newsletter leaves the queue: as soon as the article is published, at a set time, or gathered into a digest. */
  newsletterMode: NewsletterMode;
  /** All four undefined until a real mail provider is configured — dispatch refuses to run rather than pretending to send. */
  newsletterProvider: string | undefined;
  newsletterApiKey: string | undefined;
  newsletterFrom: string | undefined;
  newsletterAudienceId: string | undefined;
  /** Hours to wait before a "scheduled" issue may go out. */
  newsletterScheduleDelayHours: number;
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

const DEFAULT_MODEL = raw.OPENAI_MODEL || "gpt-4o-mini";

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
    modelAnalysis: raw.OPENAI_MODEL_ANALYSIS || DEFAULT_MODEL,
    modelWriting: raw.OPENAI_MODEL_WRITING || DEFAULT_MODEL,
    modelFactcheck: raw.OPENAI_MODEL_FACTCHECK || DEFAULT_MODEL,
    copyRiskBlockThreshold: Number(raw.COPY_RISK_BLOCK_THRESHOLD ?? 40),
    googleSearchConsoleCredentialsJson: raw.GOOGLE_SEARCH_CONSOLE_CREDENTIALS_JSON || undefined,
    googleSearchConsoleSiteUrl: raw.GOOGLE_SEARCH_CONSOLE_SITE_URL || undefined,
    siteUrl: raw.SITE_URL || "https://weblack.fr",
    newsletterMode: parseNewsletterMode(raw.NEWSLETTER_MODE),
    newsletterProvider: raw.NEWSLETTER_PROVIDER || undefined,
    newsletterApiKey: raw.NEWSLETTER_API_KEY || undefined,
    newsletterFrom: raw.NEWSLETTER_FROM || undefined,
    newsletterAudienceId: raw.NEWSLETTER_AUDIENCE_ID || undefined,
    newsletterScheduleDelayHours: Number(raw.NEWSLETTER_SCHEDULE_DELAY_HOURS ?? 24),
  };
}

export type NewsletterMode = "immediate" | "scheduled" | "digest";

function parseNewsletterMode(value: string | undefined): NewsletterMode {
  if (value === "immediate" || value === "scheduled" || value === "digest") return value;
  // Digest is the safe default: nothing leaves on its own until someone
  // decides an issue is ready to go out.
  return "digest";
}
