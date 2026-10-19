/**
 * Tests des fonctions Pages réelles (submit.ts, upload.ts) contre des
 * doublures en mémoire de D1 et KV — aucun appel à la production, aucune
 * candidature réelle créée. Seul `fetch` (lecture des paramètres Sanity,
 * envoi Resend) est remplacé, pour piloter l'état de campagne.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as submit } from "../api/talent-application/submit.ts";
import { onRequestPost as upload } from "../api/talent-application/upload.ts";
import { TEST_PHOTO_IDS, validPayload } from "./testFixtures.ts";

interface StoredValue {
  value: string | ArrayBuffer;
  metadata: Record<string, unknown> | null;
  ttl: number | undefined;
}

class FakeKV {
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

interface RecordedStatement {
  sql: string;
  values: unknown[];
}

class FakeD1 {
  batches: RecordedStatement[][] = [];
  failNextBatch = false;
  prepare(sql: string) {
    const statement = {
      sql,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        return { ...statement, values };
      },
    };
    return statement;
  }
  async batch(statements: RecordedStatement[]) {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("D1 indisponible");
    }
    this.batches.push(statements);
    return [];
  }
}

let campaign = { applicationsOpen: true, minorsAllowed: false };
let sentEmails: { to: string; subject: string }[] = [];
let ipCounter = 0;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.sanity.io")) return new Response(JSON.stringify({ result: campaign }));
  if (url.includes("api.resend.com")) {
    const body = JSON.parse(String(init?.body));
    sentEmails.push({ to: body.to[0], subject: body.subject });
    return new Response("{}");
  }
  throw new Error(`appel réseau inattendu : ${url}`);
}) as typeof fetch;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0x01, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);

function makeEnv(extra: Record<string, unknown> = {}) {
  return { DB: new FakeD1(), PHOTOS: new FakeKV(), SANITY_PROJECT_ID: "test", SANITY_DATASET: "test", ...extra };
}

async function seedPhotos(kv: FakeKV, ids: string[]) {
  for (const id of ids) await kv.put(`photo:${id}`, JPEG, { expirationTtl: 7200, metadata: { contentType: "image/jpeg" } });
}

function submitRequest(body: unknown): Request {
  ipCounter += 1;
  return new Request("https://weblack.test/api/talent-application/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.0.0.${ipCounter}` },
    body: JSON.stringify(body),
  });
}

async function callSubmit(env: ReturnType<typeof makeEnv>, body: unknown) {
  const response = await submit({ request: submitRequest(body), env: env as never, params: {} });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const ALL_IDS = [TEST_PHOTO_IDS.portrait, TEST_PHOTO_IDS.profile, TEST_PHOTO_IDS.fullLength];

beforeEach(() => {
  campaign = { applicationsOpen: true, minorsAllowed: false };
  sentEmails = [];
});

test("submit — candidature valide : dossier et références photo écrits en une transaction, photos rendues permanentes", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload());

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(String(body.reference), /^[0-9A-F]{8}$/);
  assert.equal(env.DB.batches.length, 1, "une seule transaction");
  const [applicationInsert, ...photoInserts] = env.DB.batches[0]!;
  assert.match(applicationInsert!.sql, /INSERT INTO applications/);
  assert.equal(photoInserts.length, 3);
  for (const id of ALL_IDS) assert.equal(env.PHOTOS.store.get(`photo:${id}`)?.ttl, undefined, "plus de TTL après promotion");

  // Les nouvelles données sont stockées dans les colonnes prévues, en codes.
  const columns = applicationInsert!.sql.match(/\(([^)]+)\) VALUES/)![1]!.split(", ");
  const value = (column: string) => applicationInsert!.values[columns.indexOf(column)];
  assert.equal(value("talent_category"), "runway");
  assert.equal(value("experience_duration"), "none");
  assert.equal(value("languages"), JSON.stringify(["fr", "wo"]));
  assert.equal(value("phone"), "+221770000000");
  assert.equal(value("submission_lang"), "fr");
  assert.equal(value("is_minor"), 0);
});

test("submit — photo inexistante ou expirée : refus, aucune écriture D1", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, [TEST_PHOTO_IDS.portrait, TEST_PHOTO_IDS.profile]); // full_length absente
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 422);
  assert.equal(body.reason, "photo_missing_or_expired");
  assert.equal(env.DB.batches.length, 0);
});

test("submit — échec D1 : erreur explicite, jamais de succès affiché, photos rétrogradées pour expirer", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  env.DB.failNextBatch = true;
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "storage");
  for (const id of ALL_IDS) assert.equal(env.PHOTOS.store.get(`photo:${id}`)?.ttl, 7200, "photo redevenue temporaire");
});

test("submit — mineur refusé côté serveur même si le navigateur est contourné", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload({ birthDate: "2012-05-05" }));
  assert.equal(status, 422);
  assert.deepEqual(body.errors, [{ field: "birthDate", reason: "minors_not_accepted" }]);
  assert.equal(env.DB.batches.length, 0);
});

test("submit — campagne fermée dans Sanity : refus 403, aucune écriture", async () => {
  campaign = { applicationsOpen: false, minorsAllowed: false };
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 403);
  assert.equal(body.reason, "closed");
  assert.equal(env.DB.batches.length, 0);
});

test("submit — une réponse d'erreur ne renvoie aucune donnée personnelle reçue", async () => {
  const env = makeEnv();
  const { body } = await callSubmit(env, validPayload({ email: "fuite-possible@nulle-part", phone: "0099" }));
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("fuite-possible"));
  assert.ok(!serialized.includes("Diallo"));
});

test("submit — corps non JSON ou démesuré refusé proprement", async () => {
  const env = makeEnv();
  const bad = await submit({
    request: new Request("https://weblack.test/x", { method: "POST", body: "{pas du json", headers: { "CF-Connecting-IP": "10.1.0.1" } }),
    env: env as never,
    params: {},
  });
  assert.equal(bad.status, 400);
  const huge = await submit({
    request: new Request("https://weblack.test/x", { method: "POST", body: "x".repeat(70_000), headers: { "CF-Connecting-IP": "10.1.0.2" } }),
    env: env as never,
    params: {},
  });
  assert.equal(huge.status, 413);
});

test("submit — e-mail de confirmation dans la langue du candidat", async () => {
  const env = makeEnv({ NEWSLETTER_API_KEY: "test-key", RESEND_FROM: "talent@weblack.test" });
  await seedPhotos(env.PHOTOS, ALL_IDS);
  await callSubmit(env, validPayload({ lang: "en" }));
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0]!.subject, /Your application has been received/);
});

async function callUpload(file: File, role = "portrait") {
  const env = makeEnv();
  ipCounter += 1;
  const form = new FormData();
  form.set("role", role);
  form.set("photo", file);
  const response = await upload({
    request: new Request("https://weblack.test/api/talent-application/upload", {
      method: "POST",
      body: form,
      headers: { "CF-Connecting-IP": `10.2.0.${ipCounter}` },
    }),
    env: env as never,
    params: {},
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, env };
}

test("upload — JPEG valide accepté, stocké temporairement avec son type réel", async () => {
  const { status, body, env } = await callUpload(new File([JPEG], "photo.jpg", { type: "image/jpeg" }));
  assert.equal(status, 200);
  assert.match(String(body.photoId), /^[0-9a-f-]{36}$/);
  const stored = env.PHOTOS.store.get(`photo:${body.photoId}`);
  assert.equal(stored?.ttl, 7200);
  assert.equal(stored?.metadata?.contentType, "image/jpeg");
});

test("upload — type déclaré, extension et contenu réel doivent concorder", async () => {
  assert.equal((await callUpload(new File([JPEG], "photo.png", { type: "image/jpeg" }))).body.reason, "invalid_type");
  assert.equal((await callUpload(new File([PNG], "photo.jpg", { type: "image/jpeg" }))).body.reason, "invalid_type");
  assert.equal((await callUpload(new File(["texte"], "photo.jpg", { type: "image/jpeg" }))).body.reason, "invalid_type");
  assert.equal((await callUpload(new File([JPEG], "photo.gif", { type: "image/gif" }))).body.reason, "invalid_type");
});

test("upload — fichier vide ou rôle inconnu refusés", async () => {
  assert.equal((await callUpload(new File([], "photo.jpg", { type: "image/jpeg" }))).body.reason, "invalid_size");
  assert.equal((await callUpload(new File([JPEG], "photo.jpg", { type: "image/jpeg" }), "admin")).body.reason, "invalid_role");
});
