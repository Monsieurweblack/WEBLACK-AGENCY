/**
 * Déclarations d'ambiance minimales pour les fonctions Cloudflare Pages —
 * même choix que functions/api/newsletter.ts (PagesContext/PagesHandler
 * déclarés à la main) : installer @cloudflare/workers-types entier pour
 * quelques formes alourdirait les dépendances sans rien apporter au build
 * (Cloudflare ne regarde que le nom de l'export, pas son type). Ce fichier
 * couvre uniquement ce que ces fonctions utilisent réellement — KV, D1, et
 * la forme d'un handler de Pages Function.
 */

interface KVNamespacePutOptions {
  expirationTtl?: number;
  metadata?: Record<string, unknown>;
}

interface KVNamespaceGetWithMetadataResult<T> {
  value: T | null;
  metadata: Record<string, unknown> | null;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  getWithMetadata(key: string, type: "arrayBuffer"): Promise<KVNamespaceGetWithMetadataResult<ArrayBuffer>>;
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: KVNamespacePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Exécute les instructions dans une seule transaction : tout ou rien. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface PagesFunctionContext<Env> {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  /** Prolonge l'exécution après l'envoi de la réponse (absent dans les tests). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

type PagesFunction<Env = Record<string, unknown>> = (context: PagesFunctionContext<Env>) => Promise<Response>;
