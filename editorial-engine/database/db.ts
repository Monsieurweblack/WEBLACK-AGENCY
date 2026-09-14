/**
 * Local run history — uses Node's built-in `node:sqlite` (stable since
 * Node 22.5, this project already requires Node >=22.12) so no extra
 * dependency is needed for the SQLite requirement. Its whole job is to make
 * dedup and auditing reliable across runs; it is never read by the Astro
 * site itself.
 *
 * Migration note (Phase 16 asked for this to be documented): moving to
 * Postgres later just means swapping this module's implementation behind
 * the same exported functions — no caller elsewhere in the engine touches
 * SQL directly.
 */
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ENGINE_ROOT } from "../config/env.ts";

const DB_DIR = path.join(ENGINE_ROOT, "database");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
// Test isolation hook (§13): unit tests point this at a throwaway file so
// they never read or write the real local run history. Unset in normal use.
const DB_PATH = process.env.EDITORIAL_TEST_DB || path.join(DB_DIR, "history.sqlite3");

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_title TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    lang TEXT,
    generated_title TEXT,
    generated_slug TEXT,
    editorial_score REAL,
    confidence_score REAL,
    status TEXT NOT NULL, -- 'skipped-duplicate' | 'skipped-low-score' | 'draft' | 'published' | 'error'
    sanity_document_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_hash ON runs(source_hash);
`);

// §1 Level 1/2 dedup columns — added via ALTER so an existing local db file
// (created before this hardening pass) keeps working; SQLite has no
// "ADD COLUMN IF NOT EXISTS", so the guard is a try/catch on the duplicate
// error instead.
for (const stmt of [
  "ALTER TABLE runs ADD COLUMN canonical_url TEXT",
  "ALTER TABLE runs ADD COLUMN content_hash TEXT",
]) {
  try {
    db.exec(stmt);
  } catch {
    // column already exists — fine
  }
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_runs_canonical_url ON runs(canonical_url);
  CREATE INDEX IF NOT EXISTS idx_runs_content_hash ON runs(content_hash);
`);

export interface RunRecord {
  id?: number;
  sourceUrl: string;
  sourceName: string;
  sourceTitle: string;
  sourceHash: string;
  /** §1 Level 1 — canonicalized URL, so two runs of the exact same article are recognized regardless of tracking params. */
  canonicalUrl?: string;
  /** §1 Level 2 — hash of the full source body text, catches the same content republished under a different URL/title. */
  contentHash?: string;
  lang?: string;
  generatedTitle?: string;
  generatedSlug?: string;
  editorialScore?: number;
  confidenceScore?: number;
  status: "skipped-duplicate" | "skipped-low-score" | "draft" | "published" | "error";
  sanityDocumentId?: string;
  error?: string;
  createdAt?: string;
}

export function insertRun(record: RunRecord): number {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO runs (source_url, source_name, source_title, source_hash, canonical_url, content_hash, lang, generated_title, generated_slug, editorial_score, confidence_score, status, sanity_document_id, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    record.sourceUrl,
    record.sourceName,
    record.sourceTitle,
    record.sourceHash,
    record.canonicalUrl ?? null,
    record.contentHash ?? null,
    record.lang ?? null,
    record.generatedTitle ?? null,
    record.generatedSlug ?? null,
    record.editorialScore ?? null,
    record.confidenceScore ?? null,
    record.status,
    record.sanityDocumentId ?? null,
    record.error ?? null,
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

export function findRunByHash(hash: string): RunRecord | undefined {
  const row = db.prepare(`SELECT * FROM runs WHERE source_hash = ? ORDER BY id DESC LIMIT 1`).get(hash) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return mapRow(row);
}

export function findRunByCanonicalUrl(canonicalUrl: string): RunRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM runs WHERE canonical_url = ? AND status != 'error' ORDER BY id DESC LIMIT 1`)
    .get(canonicalUrl) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return mapRow(row);
}

export function findRunByContentHash(contentHash: string): RunRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM runs WHERE content_hash = ? AND status != 'error' ORDER BY id DESC LIMIT 1`)
    .get(contentHash) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return mapRow(row);
}

export function recentRuns(limit = 50): RunRecord[] {
  const rows = db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT ?`).all(limit) as Record<string, unknown>[];
  return rows.map(mapRow);
}

function mapRow(row: Record<string, unknown>): RunRecord {
  return {
    id: row.id as number,
    sourceUrl: row.source_url as string,
    sourceName: row.source_name as string,
    sourceTitle: row.source_title as string,
    sourceHash: row.source_hash as string,
    canonicalUrl: (row.canonical_url as string) ?? undefined,
    contentHash: (row.content_hash as string) ?? undefined,
    lang: (row.lang as string) ?? undefined,
    generatedTitle: (row.generated_title as string) ?? undefined,
    generatedSlug: (row.generated_slug as string) ?? undefined,
    editorialScore: (row.editorial_score as number) ?? undefined,
    confidenceScore: (row.confidence_score as number) ?? undefined,
    status: row.status as RunRecord["status"],
    sanityDocumentId: (row.sanity_document_id as string) ?? undefined,
    error: (row.error as string) ?? undefined,
    createdAt: (row.created_at as string) ?? undefined,
  };
}
