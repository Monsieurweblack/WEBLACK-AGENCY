/**
 * Doublures de test pour D1 et KV — utilisées uniquement par les tests
 * unitaires, jamais en production.
 *
 * D1 est simulé par une VRAIE base SQLite en mémoire (node:sqlite) à
 * laquelle on applique les migrations du dépôt : contraintes d'unicité,
 * clés étrangères, transactions de batch() et requêtes réelles des
 * fonctions sont donc exercées telles quelles, pas imitées.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

interface StoredValue {
  value: string | ArrayBuffer;
  metadata: Record<string, unknown> | null;
  ttl: number | undefined;
}

export class FakeKV {
  store = new Map<string, StoredValue>();
  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    return typeof entry?.value === "string" ? entry.value : null;
  }
  async getWithMetadata(key: string): Promise<{ value: ArrayBuffer | null; metadata: Record<string, unknown> | null }> {
    const entry = this.store.get(key);
    if (!entry || typeof entry.value === "string") return { value: null, metadata: null };
    return { value: entry.value, metadata: entry.metadata };
  }
  async put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }) {
    const stored = value instanceof Uint8Array ? value.slice().buffer : value;
    this.store.set(key, { value: stored, metadata: options?.metadata ?? null, ttl: options?.expirationTtl });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

class SqliteStatement {
  private readonly d1: SqliteD1;
  readonly sql: string;
  readonly values: SQLInputValue[];
  constructor(d1: SqliteD1, sql: string, values: SQLInputValue[] = []) {
    this.d1 = d1;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]) {
    return new SqliteStatement(this.d1, this.sql, values as SQLInputValue[]);
  }
  runSync() {
    const result = this.d1.db.prepare(this.sql).run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async run() {
    this.d1.assertAvailable();
    return this.runSync();
  }
  async all<T>() {
    this.d1.assertAvailable();
    return { results: this.d1.db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0, last_row_id: 0 } };
  }
  async first<T>() {
    this.d1.assertAvailable();
    return (this.d1.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

export class SqliteD1 {
  db = new DatabaseSync(":memory:");
  /** Fait échouer le prochain batch() (panne D1 simulée) — rien n'est écrit. */
  failNextBatch = false;
  /** Rend toute requête impossible (D1 injoignable). */
  unavailable = false;
  batchCount = 0;

  constructor() {
    this.db.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      this.db.exec(readFileSync(new URL(file, MIGRATIONS_DIR), "utf8"));
    }
  }
  assertAvailable() {
    if (this.unavailable) throw new Error("D1 injoignable");
  }
  prepare(sql: string) {
    return new SqliteStatement(this, sql);
  }
  async batch(statements: SqliteStatement[]) {
    this.assertAvailable();
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("D1 indisponible");
    }
    this.db.exec("BEGIN");
    try {
      const results = statements.map((s) => s.runSync());
      this.db.exec("COMMIT");
      this.batchCount += 1;
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Lecture directe pour les assertions. */
  rows<T = Record<string, unknown>>(sql: string, ...values: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...values) as T[];
  }
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0x01, 0xff, 0xd9]);
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);

export async function seedPhotos(kv: FakeKV, ids: string[]) {
  for (const id of ids) await kv.put(`photo:${id}`, JPEG, { expirationTtl: 7200, metadata: { contentType: "image/jpeg" } });
}

/** Comportement simulé des services externes (Sanity, Resend), piloté test par test. */
export const network = {
  campaign: { applicationsOpen: true, minorsAllowed: false, internalNotificationEmail: "equipe@example.com" } as Record<string, unknown>,
  sanityDown: false,
  resend: "ok" as "ok" | "server_error" | "invalid_key" | "network",
  sent: [] as { to: string; subject: string; text: string; html: string; idempotencyKey: string | null; replyTo?: string }[],
  resendCalls: 0,
  reset() {
    this.campaign = { applicationsOpen: true, minorsAllowed: false, internalNotificationEmail: "equipe@example.com" };
    this.sanityDown = false;
    this.resend = "ok";
    this.sent = [];
    this.resendCalls = 0;
  },
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.sanity.io")) {
    if (network.sanityDown) return new Response("upstream error", { status: 503 });
    return new Response(JSON.stringify({ result: network.campaign }));
  }
  if (url.includes("api.resend.com")) {
    network.resendCalls += 1;
    if (network.resend === "network") throw new TypeError("fetch failed");
    if (network.resend === "server_error") {
      // Le message d'erreur d'un fournisseur peut recopier l'adresse : il ne doit jamais être conservé.
      return new Response(JSON.stringify({ name: "internal_server_error", message: "failed for awa@example.com" }), { status: 500 });
    }
    if (network.resend === "invalid_key") return new Response(JSON.stringify({ name: "validation_error", message: "API key is invalid" }), { status: 401 });
    const body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    network.sent.push({ to: body.to[0], subject: body.subject, text: body.text, html: body.html, idempotencyKey: headers.get("Idempotency-Key"), replyTo: body.reply_to });
    return new Response(JSON.stringify({ id: `re_${network.sent.length}` }));
  }
  throw new Error(`appel réseau inattendu : ${url}`);
}) as typeof fetch;
