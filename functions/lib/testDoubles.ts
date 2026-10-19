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

// --- Doublure Google Drive (API v3) ---------------------------------------------------

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  size: number;
  trashed: boolean;
  permissions: { id: string; type: string; role: string }[];
}

type DriveMode = "ok" | "server_error" | "quota" | "timeout" | "unavailable" | "unauthorized" | "lose_upload_response";

export const fakeDrive = {
  files: new Map<string, FakeDriveFile>(),
  oauth: "ok" as "ok" | "invalid_grant" | "invalid_client" | "timeout",
  mode: "ok" as DriveMode,
  /** Panne seulement à partir du N-ième appel Drive (0 = dès le premier). */
  failAfterCalls: 0,
  calls: 0,
  uploads: 0,
  tokenRequests: 0,
  issuedToken: "ya29.test-access-token",
  reset() {
    this.files = new Map();
    this.oauth = "ok";
    this.mode = "ok";
    this.failAfterCalls = 0;
    this.calls = 0;
    this.uploads = 0;
    this.tokenRequests = 0;
  },
  live(): FakeDriveFile[] {
    return [...this.files.values()].filter((f) => !f.trashed);
  },
};

let driveIds = 0;

function driveJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function driveError(status: number, reason: string) {
  return driveJson({ error: { code: status, message: `failure for secret file name`, errors: [{ reason }] } }, status);
}

/** Comme Drive : un élément placé dans un dossier mis à la corbeille est lui-même à la corbeille. */
function isTrashed(f: FakeDriveFile): boolean {
  return f.trashed || f.parents.some((p) => {
    const parent = fakeDrive.files.get(p);
    return parent ? isTrashed(parent) : false;
  });
}

function matchesQuery(file: FakeDriveFile, q: string): boolean {
  if (/trashed = false/.test(q) && isTrashed(file)) return false;
  for (const m of q.matchAll(/'([^']+)' in parents/g)) if (!file.parents.includes(m[1]!)) return false;
  for (const m of q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)) if (file.appProperties[m[1]!] !== m[2]) return false;
  return true;
}

function view(file: FakeDriveFile) {
  return { id: file.id, name: file.name, size: String(file.size), trashed: isTrashed(file), parents: file.parents, appProperties: file.appProperties };
}

async function handleDrive(url: URL, init: RequestInit | undefined): Promise<Response> {
  if (url.hostname === "oauth2.googleapis.com") {
    fakeDrive.tokenRequests += 1;
    if (fakeDrive.oauth === "timeout") throw new DOMException("timed out", "TimeoutError");
    if (fakeDrive.oauth === "invalid_grant") return driveJson({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
    if (fakeDrive.oauth === "invalid_client") return driveJson({ error: "invalid_client" }, 401);
    return driveJson({ access_token: fakeDrive.issuedToken, expires_in: 3599, scope: "https://www.googleapis.com/auth/drive.file", token_type: "Bearer" });
  }

  fakeDrive.calls += 1;
  const headers = new Headers(init?.headers);
  if (headers.get("Authorization") !== `Bearer ${fakeDrive.issuedToken}` || fakeDrive.mode === "unauthorized") return driveError(401, "authError");
  const failing = fakeDrive.calls > fakeDrive.failAfterCalls;
  if (failing && fakeDrive.mode === "timeout") throw new DOMException("timed out", "TimeoutError");
  if (failing && fakeDrive.mode === "server_error") return driveError(500, "backendError");
  if (failing && fakeDrive.mode === "unavailable") return driveError(503, "backendError");
  if (failing && fakeDrive.mode === "quota") return driveError(403, "userRateLimitExceeded");

  const method = init?.method ?? "GET";
  const path = url.pathname;

  if (path === "/upload/drive/v3/files" && method === "POST") {
    const boundary = headers.get("Content-Type")!.split("boundary=")[1]!;
    const raw = Buffer.from(init!.body as Uint8Array);
    const text = raw.toString("latin1");
    const metaStart = text.indexOf("\r\n\r\n") + 4;
    const metaEnd = text.indexOf(`\r\n--${boundary}`, metaStart);
    const meta = JSON.parse(Buffer.from(raw.subarray(metaStart, metaEnd)).toString("utf8"));
    const mediaStart = text.indexOf("\r\n\r\n", metaEnd + 2) + 4;
    const mediaEnd = text.lastIndexOf(`\r\n--${boundary}--`);
    const file: FakeDriveFile = { id: `f${++driveIds}`, name: meta.name, mimeType: "application/octet-stream", parents: meta.parents, appProperties: meta.appProperties ?? {}, size: mediaEnd - mediaStart, trashed: false, permissions: [{ id: "owner", type: "user", role: "owner" }] };
    fakeDrive.files.set(file.id, file);
    fakeDrive.uploads += 1;
    if (fakeDrive.mode === "lose_upload_response" && fakeDrive.uploads === 1) throw new TypeError("fetch failed");
    return driveJson(view(file));
  }
  if (path === "/drive/v3/files" && method === "POST") {
    const meta = JSON.parse(String(init!.body));
    const file: FakeDriveFile = { id: `d${++driveIds}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? ["root"], appProperties: meta.appProperties ?? {}, size: 0, trashed: false, permissions: [{ id: "owner", type: "user", role: "owner" }] };
    fakeDrive.files.set(file.id, file);
    return driveJson(view(file));
  }
  if (path === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    return driveJson({ files: [...fakeDrive.files.values()].filter((f) => matchesQuery(f, q)).map(view) });
  }
  const permissions = path.match(/^\/drive\/v3\/files\/([^/]+)\/permissions$/);
  if (permissions) {
    const file = fakeDrive.files.get(decodeURIComponent(permissions[1]!));
    return file ? driveJson({ permissions: file.permissions }) : driveError(404, "notFound");
  }
  const single = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (single) {
    const file = fakeDrive.files.get(decodeURIComponent(single[1]!));
    if (!file) return driveError(404, "notFound");
    if (method === "PATCH") Object.assign(file, JSON.parse(String(init!.body)));
    return driveJson(view(file));
  }
  throw new Error(`appel Drive inattendu : ${method} ${url}`);
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/^https:\/\/(oauth2|www)\.googleapis\.com\//.test(url)) return handleDrive(new URL(url), init);
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
