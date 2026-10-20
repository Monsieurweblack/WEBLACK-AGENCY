/**
 * Archivage Google Drive — fonctions réelles (submit.ts, driveSync.ts,
 * routes admin) contre la base SQLite de test et une doublure de l'API
 * Drive v3 (testDoubles.ts). Aucun appel à Google, aucune donnée réelle.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as submit } from "../api/talent-application/submit.ts";
import { onRequestGet as driveStatus, onRequestPost as driveRetry } from "../api/admin/drive.ts";
import { onRequestDelete as deleteApplication, onRequestGet as getApplication } from "../api/admin/applications/[id].ts";
import { createSessionCookie } from "./adminSession.ts";
import { MAX_DRIVE_ATTEMPTS, syncDrive } from "./driveSync.ts";
import { TEST_PHOTO_IDS, validPayload } from "./testFixtures.ts";
import { FakeKV, fakeDrive, network, seedPhotos, SqliteD1 } from "./testDoubles.ts";

const SECRET = crypto.randomUUID() + crypto.randomUUID();
const EXTRA = "88888888-8888-4888-8888-888888888888";
const ALL_IDS = [TEST_PHOTO_IDS.portrait, TEST_PHOTO_IDS.profile, TEST_PHOTO_IDS.fullLength, EXTRA];
let ip = 0;

function makeEnv(extra: Record<string, unknown> = {}) {
  return {
    DB: new SqliteD1(),
    PHOTOS: new FakeKV(),
    SANITY_PROJECT_ID: "test",
    SANITY_DATASET: "test",
    NEWSLETTER_API_KEY: "test-key",
    RESEND_FROM: "talents@weblack.test",
    ADMIN_SESSION_SECRET: SECRET,
    GOOGLE_OAUTH_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "1//test-refresh-token",
    ...extra,
  };
}
type Env = ReturnType<typeof makeEnv>;

function request(path: string, init: RequestInit & { cookie?: string } = {}) {
  ip += 1;
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", `10.5.${Math.floor(ip / 250)}.${ip % 250}`);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(`https://weblack.test${path}`, { ...init, headers });
}

async function submitApplication(env: Env, overrides: Record<string, unknown> = {}) {
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const payload = validPayload({ submissionId: crypto.randomUUID(), ...overrides });
  (payload.photoIds as Record<string, unknown>).extra = [EXTRA];
  const response = await submit({ request: request("/api/talent-application/submit", { method: "POST", body: JSON.stringify(payload) }), env: env as never, params: {} });
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, payload };
}

const appId = (env: Env) => env.DB.rows<{ id: string }>(`SELECT id FROM applications`)[0]!.id;
const syncRow = (env: Env) => env.DB.rows<Record<string, unknown>>(`SELECT * FROM drive_sync`)[0]!;
const driveFiles = (env: Env) => env.DB.rows<{ source_id: string; drive_file_id: string; size_bytes: number }>(`SELECT * FROM drive_files ORDER BY source_id`);
const cookie = async () => (await createSessionCookie(SECRET)).split(";")[0]!;
const liveUploads = () => fakeDrive.live().filter((f) => f.appProperties.weblackSourceId);
const liveFolders = () => fakeDrive.live().filter((f) => f.mimeType === "application/vnd.google-apps.folder");

beforeEach(() => {
  network.reset();
  fakeDrive.reset();
});

test("drive 1-5 — connexion, arborescence, téléversement de plusieurs photos, présence vérifiée, identifiants enregistrés", async () => {
  const env = makeEnv();
  const { status, body } = await submitApplication(env);
  assert.equal(status, 200);
  const id = appId(env);
  const reference = String(body.reference);

  assert.equal(fakeDrive.tokenRequests > 0, true, "jeton d'accès obtenu par renouvellement OAuth");
  const row = syncRow(env);
  assert.equal(row.status, "synced");
  assert.ok(row.last_synced_at);

  // WEBLACK TALENTS / 2026 / Candidatures / REF
  const byId = new Map(fakeDrive.live().map((f) => [f.id, f]));
  const folder = byId.get(String(row.folder_id))!;
  assert.equal(folder.name, reference, "dossier nommé par la référence seule");
  const candidatures = byId.get(folder.parents[0]!)!;
  const year = byId.get(candidatures.parents[0]!)!;
  const root = byId.get(year.parents[0]!)!;
  assert.deepEqual([root.name, year.name, candidatures.name], ["WEBLACK TALENTS", new Date().toISOString().slice(0, 4), "Candidatures"]);
  assert.equal(folder.appProperties.weblackApplicationId, id);

  // Récapitulatif + 4 photos, vérifiés puis enregistrés avec leur identifiant Drive.
  const files = driveFiles(env);
  assert.equal(files.length, 5);
  for (const file of files) {
    const remote = byId.get(file.drive_file_id)!;
    assert.ok(remote, "l'identifiant enregistré désigne un fichier réellement présent");
    assert.equal(remote.parents[0], folder.id);
    assert.equal(remote.size, file.size_bytes);
  }
  const names = liveUploads().map((f) => f.name).sort();
  assert.deepEqual(names, [`${reference}-complementaire-1.jpg`, `${reference}-en-pied.jpg`, `${reference}-portrait.jpg`, `${reference}-profil.jpg`, `${reference}-recapitulatif.txt`]);
  assert.ok(!names.some((n) => /Awa|Diallo|@/.test(n)), "aucune donnée personnelle dans les noms de fichiers");
});

test("drive — le récapitulatif relie l'archive au dossier et reste lisible", async () => {
  const env = makeEnv();
  const { body } = await submitApplication(env);
  const summary = fakeDrive.live().find((f) => f.appProperties.weblackSourceId === "summary")!;
  assert.equal(summary.name, `${body.reference}-recapitulatif.txt`);
  const { renderSummary } = await import("./driveSync.ts");
  const application = env.DB.rows<Record<string, unknown>>(`SELECT * FROM applications`)[0]!;
  const text = renderSummary(application as never, [{ id: "x", role: "portrait", content_type: "image/jpeg" }], String(body.reference));
  assert.ok(text.includes(`Référence : ${body.reference}`) && text.includes(`Identifiant système : ${application.id}`));
  assert.ok(text.includes("Catégorie : Mannequin runway / défilé") && text.includes("Mobilité : Internationale") && text.includes("Pays : Sénégal"));
  assert.ok(!/undefined|null/.test(text));
});

test("drive 6 — aucun partage public ; un partage public détecté bloque le statut « synced »", async () => {
  const env = makeEnv();
  await submitApplication(env);
  for (const file of fakeDrive.live()) assert.deepEqual(file.permissions.map((p) => p.type), ["user"]);

  // Quelqu'un ouvre le dossier par lien public : la reprise le signale, sans relance automatique.
  const folder = fakeDrive.files.get(String(syncRow(env).folder_id))!;
  folder.permissions.push({ id: "anyone", type: "anyone", role: "reader" });
  env.DB.db.prepare(`UPDATE drive_sync SET status = 'pending_sync'`).run();
  await syncDrive(env as never, { force: true });
  assert.equal(syncRow(env).status, "sync_failed");
  assert.equal(syncRow(env).last_error, "public_permission_detected");
  assert.equal(syncRow(env).attempts, MAX_DRIVE_ATTEMPTS);
});

test("drive 7 — nouvelle tentative après une panne au milieu : ni dossier ni fichier en double", async () => {
  fakeDrive.mode = "server_error";
  fakeDrive.failAfterCalls = 11; // 8 appels de dossiers + relecture + 2 téléversements, puis panne
  const env = makeEnv();
  await submitApplication(env);
  assert.equal(syncRow(env).status, "sync_failed");
  assert.equal(syncRow(env).last_error, "drive_http_500:backendError");
  const partial = liveUploads().length;
  assert.ok(partial > 0 && partial < 5, `archivage partiel avant la panne (${partial})`);

  fakeDrive.mode = "ok";
  await syncDrive(env as never, { force: true });
  assert.equal(syncRow(env).status, "synced");
  assert.equal(liveUploads().length, 5, "exactement 5 fichiers");
  assert.equal(liveFolders().length, 4, "exactement 4 dossiers");

  // Une relance de plus sur un dossier déjà archivé ne fait rien.
  await syncDrive(env as never, { force: true });
  assert.equal(liveUploads().length, 5);
});

test("drive 7 — réponse de téléversement perdue (le fichier existe chez Google) : retrouvé, pas retéléversé", async () => {
  fakeDrive.mode = "lose_upload_response";
  const env = makeEnv();
  await submitApplication(env);
  assert.equal(syncRow(env).status, "sync_failed");
  assert.equal(syncRow(env).last_error, "network");
  fakeDrive.mode = "ok";
  await syncDrive(env as never, { force: true });
  assert.equal(syncRow(env).status, "synced");
  assert.equal(liveUploads().length, 5);
  assert.equal(new Set(liveUploads().map((f) => f.appProperties.weblackSourceId)).size, 5);
});

test("drive 7 — deux dossiers de candidature partagent la même arborescence commune", async () => {
  const env = makeEnv();
  await submitApplication(env);
  await seedPhotos(env.PHOTOS, ["99999999-9999-4999-8999-999999999991", "99999999-9999-4999-8999-999999999992", "99999999-9999-4999-8999-999999999993"]);
  const second = validPayload({
    submissionId: crypto.randomUUID(),
    email: "deux@example.com",
    photoIds: { portrait: ["99999999-9999-4999-8999-999999999991"], profile: ["99999999-9999-4999-8999-999999999992"], full_length: ["99999999-9999-4999-8999-999999999993"], extra: [] },
  });
  await submit({ request: request("/x", { method: "POST", body: JSON.stringify(second) }), env: env as never, params: {} });
  assert.equal(liveFolders().length, 5, "racine + année + Candidatures + 2 dossiers de candidature");
});

test("drive 8 — jeton révoqué ou expiré (invalid_grant) : échec explicite, pas de relance automatique en boucle", async () => {
  fakeDrive.oauth = "invalid_grant";
  const env = makeEnv();
  const { status, body } = await submitApplication(env);
  assert.equal(status, 200, "la candidature est enregistrée malgré tout");
  assert.equal(body.confirmationEmail, "sent");
  assert.equal(syncRow(env).status, "sync_failed");
  assert.equal(syncRow(env).last_error, "oauth_invalid_grant");
  assert.equal(syncRow(env).attempts, MAX_DRIVE_ATTEMPTS);

  const calls = fakeDrive.tokenRequests;
  await syncDrive(env as never, { now: new Date(Date.now() + 86_400_000) });
  assert.equal(fakeDrive.tokenRequests, calls, "aucune relance automatique tant que l'autorisation n'est pas refaite");

  fakeDrive.oauth = "ok";
  await syncDrive(env as never, { force: true });
  assert.equal(syncRow(env).status, "synced", "relance manuelle après nouvelle autorisation");
});

test("drive 8 — client OAuth invalide, ou délai dépassé sur le serveur d'autorisation", async () => {
  fakeDrive.oauth = "invalid_client";
  const env = makeEnv();
  await submitApplication(env);
  assert.equal(syncRow(env).last_error, "oauth_invalid_client");

  fakeDrive.oauth = "timeout";
  const env2 = makeEnv();
  await submitApplication(env2);
  assert.equal(syncRow(env2).last_error, "timeout");
  assert.ok(Number(syncRow(env2).attempts) < MAX_DRIVE_ATTEMPTS, "erreur passagère : relances automatiques conservées");
});

test("drive 9 — erreur API, délai d'expiration et quota dépassé : codes techniques, candidature intacte", async () => {
  for (const [mode, code] of [["server_error", "drive_http_500:backendError"], ["timeout", "timeout"], ["quota", "drive_quota:userRateLimitExceeded"], ["unauthorized", "drive_unauthorized"]] as const) {
    fakeDrive.reset();
    fakeDrive.mode = mode;
    const env = makeEnv();
    const { status } = await submitApplication(env);
    assert.equal(status, 200, mode);
    assert.equal(syncRow(env).status, "sync_failed", mode);
    assert.equal(syncRow(env).last_error, code, mode);
    assert.equal(env.DB.rows(`SELECT id FROM applications`).length, 1);
    for (const id of ALL_IDS) assert.equal(env.PHOTOS.store.get(`photo:${id}`)?.ttl, undefined, "photos toujours conservées dans le stockage existant");
  }
});

test("drive 10-11 — Drive indisponible puis rétabli : reprise automatique après le délai, puis archivé", async () => {
  fakeDrive.mode = "unavailable";
  const env = makeEnv();
  await submitApplication(env);
  assert.equal(syncRow(env).last_error, "drive_http_503:backendError");

  fakeDrive.mode = "ok";
  const early = await syncDrive(env as never);
  assert.deepEqual(Object.values(early), ["skipped"], "délai entre tentatives respecté");
  await syncDrive(env as never, { now: new Date(Date.now() + 10 * 60 * 1000) });
  assert.equal(syncRow(env).status, "synced");
  assert.equal(liveUploads().length, 5);
});

test("drive 11 — non configuré : en attente sans tentative consommée, archivé dès l'autorisation", async () => {
  const env = makeEnv({ GOOGLE_DRIVE_REFRESH_TOKEN: undefined });
  const { status } = await submitApplication(env);
  assert.equal(status, 200);
  assert.deepEqual([syncRow(env).status, syncRow(env).attempts, syncRow(env).last_error], ["pending_sync", 0, "not_configured"]);
  assert.equal(fakeDrive.tokenRequests, 0);

  (env as Record<string, unknown>).GOOGLE_DRIVE_REFRESH_TOKEN = "1//test-refresh-token";
  await syncDrive(env as never);
  assert.equal(syncRow(env).status, "synced");
});

test("drive 12 — administration : refus sans session, détail avec lien Drive avec session, aucune fuite publique", async () => {
  const env = makeEnv();
  const { body } = await submitApplication(env);
  assert.ok(!JSON.stringify(body).includes("drive"), "la réponse publique ne mentionne ni dossier ni lien Drive");
  const id = appId(env);

  assert.equal((await driveStatus({ request: request("/api/admin/drive"), env: env as never, params: {} })).status, 401);
  assert.equal((await driveRetry({ request: request("/api/admin/drive", { method: "POST" }), env: env as never, params: {} })).status, 401);
  assert.equal((await getApplication({ request: request(`/api/admin/applications/${id}`), env: env as never, params: { id } })).status, 401);

  const session = await cookie();
  const detail = (await (await getApplication({ request: request(`/api/admin/applications/${id}`, { cookie: session }), env: env as never, params: { id } })).json()) as {
    drive: { status: string; files: number; folderUrl: string; lastSyncedAt: string };
  };
  assert.equal(detail.drive.status, "synced");
  assert.equal(detail.drive.files, 5);
  assert.equal(detail.drive.folderUrl, `https://drive.google.com/drive/folders/${syncRow(env).folder_id}`);

  const status = (await (await driveStatus({ request: request("/api/admin/drive?check=1", { cookie: session }), env: env as never, params: {} })).json()) as Record<string, unknown>;
  assert.equal(status.configured, true);
  assert.deepEqual(status.connection, { ok: true });
  assert.ok(!JSON.stringify(status).includes("test-refresh-token") && !JSON.stringify(status).includes("test-client-secret"), "aucun secret dans la réponse");

  const bad = await driveRetry({ request: request("/api/admin/drive", { method: "POST", body: '{"applicationId":"x"}', cookie: session }), env: env as never, params: {} });
  assert.equal(bad.status, 400);
});

test("drive 12 — relance manuelle d'un dossier précis depuis l'administration", async () => {
  fakeDrive.mode = "server_error";
  const env = makeEnv();
  await submitApplication(env);
  fakeDrive.mode = "ok";
  const response = await driveRetry({
    request: request("/api/admin/drive", { method: "POST", body: JSON.stringify({ applicationId: appId(env) }), cookie: await cookie() }),
    env: env as never,
    params: {},
  });
  assert.deepEqual(((await response.json()) as { outcomes: Record<string, number> }).outcomes, { synced: 1 });
});

test("drive 14 — e-mail : une seule confirmation, aucun second dossier ni second archivage sur double envoi", async () => {
  fakeDrive.mode = "unavailable";
  const env = makeEnv();
  const first = await submitApplication(env);
  const again = await submit({ request: request("/x", { method: "POST", body: JSON.stringify(first.payload) }), env: env as never, params: {} });
  const againBody = (await again.json()) as Record<string, unknown>;
  assert.equal(againBody.reference, first.body.reference);
  assert.equal(env.DB.rows(`SELECT * FROM applications`).length, 1);
  assert.equal(env.DB.rows(`SELECT * FROM drive_sync`).length, 1);
  assert.equal(network.sent.filter((m) => m.to === "awa@example.com").length, 1);
});

test("drive 15 — mineur refusé côté serveur : ni dossier, ni archivage, aucun appel Drive", async () => {
  const env = makeEnv();
  const { status } = await submitApplication(env, { birthDate: "2011-03-03" });
  assert.equal(status, 422);
  assert.equal(env.DB.rows(`SELECT * FROM drive_sync`).length, 0);
  assert.equal(fakeDrive.calls + fakeDrive.tokenRequests, 0);
});

test("drive — suppression d'un dossier : archive Drive mise à la corbeille (récupérable), refus cohérent si Drive échoue", async () => {
  const env = makeEnv();
  await submitApplication(env);
  const id = appId(env);
  const folderId = String(syncRow(env).folder_id);
  const session = await cookie();

  fakeDrive.mode = "server_error";
  const refused = await deleteApplication({ request: request(`/api/admin/applications/${id}`, { method: "DELETE", cookie: session }), env: env as never, params: { id } });
  assert.equal(refused.status, 502);
  assert.equal(env.DB.rows(`SELECT id FROM applications`).length, 1, "rien supprimé tant que Drive n'a pas confirmé");

  fakeDrive.mode = "ok";
  const ok = await deleteApplication({ request: request(`/api/admin/applications/${id}`, { method: "DELETE", cookie: session }), env: env as never, params: { id } });
  assert.equal(ok.status, 200);
  assert.equal(fakeDrive.files.get(folderId)!.trashed, true, "dossier Drive à la corbeille, pas supprimé définitivement");
  assert.ok(fakeDrive.files.size > 0);
  assert.equal(env.DB.rows(`SELECT * FROM drive_sync`).length + env.DB.rows(`SELECT * FROM drive_files`).length, 0);
});

test("drive — dossier commun mis à la corbeille à la main : arborescence recréée, pas d'archivage dans la corbeille", async () => {
  const env = makeEnv();
  await submitApplication(env);
  const root = liveFolders().find((f) => f.name === "WEBLACK TALENTS")!;
  root.trashed = true;

  await seedPhotos(env.PHOTOS, ["99999999-9999-4999-8999-999999999991", "99999999-9999-4999-8999-999999999992", "99999999-9999-4999-8999-999999999993"]);
  const second = validPayload({
    submissionId: crypto.randomUUID(),
    photoIds: { portrait: ["99999999-9999-4999-8999-999999999991"], profile: ["99999999-9999-4999-8999-999999999992"], full_length: ["99999999-9999-4999-8999-999999999993"], extra: [] },
  });
  await submit({ request: request("/x", { method: "POST", body: JSON.stringify(second) }), env: env as never, params: {} });
  const rows = env.DB.rows<{ status: string }>(`SELECT status FROM drive_sync ORDER BY created_at`);
  assert.equal(rows[1]!.status, "synced");
  assert.equal(liveFolders().filter((f) => f.name === "WEBLACK TALENTS").length, 1, "une nouvelle racine visible, l'ancienne reste à la corbeille");
});

test("auto-test d'archivage : fichier non sensible créé dans WEBLACK TALENTS / _tests-archivage, relu, retrouvé, privé", async () => {
  const env = makeEnv();
  const session = await cookie();
  const response = await driveRetry({ request: request("/api/admin/drive", { method: "POST", body: '{"action":"selftest"}', cookie: session }), env: env as never, params: {} });
  assert.equal(response.status, 200);
  const { selfTest } = (await response.json()) as { selfTest: { fileName: string; sizeBytes: number; folderUrl: string; foundByProperty: boolean } };
  assert.match(selfTest.fileName, /^test-archivage-.+\.txt$/);
  assert.equal(selfTest.foundByProperty, true);

  const file = fakeDrive.live().find((f) => f.appProperties.weblackSelfTest === "1")!;
  assert.equal(file.size, selfTest.sizeBytes);
  const tests = fakeDrive.files.get(file.parents[0]!)!;
  const root = fakeDrive.files.get(tests.parents[0]!)!;
  assert.deepEqual([root.name, tests.name], ["WEBLACK TALENTS", "_tests-archivage"]);
  assert.equal(selfTest.folderUrl, `https://drive.google.com/drive/folders/${tests.id}`);
  assert.ok(fakeDrive.live().every((f) => f.permissions.every((p) => p.type === "user")), "aucun partage public");
  assert.equal(env.DB.rows(`SELECT * FROM applications`).length, 0, "aucune candidature créée par le test");

  // La racine est réutilisée ensuite par l'archivage réel (aucune seconde racine).
  await submitApplication(env);
  assert.equal(liveFolders().filter((f) => f.name === "WEBLACK TALENTS").length, 1);
});

test("auto-test d'archivage : sans session 401, action inconnue 400, non configuré 409, panne Drive 502 avec code", async () => {
  const env = makeEnv();
  assert.equal((await driveRetry({ request: request("/api/admin/drive", { method: "POST", body: '{"action":"selftest"}' }), env: env as never, params: {} })).status, 401);
  const session = await cookie();
  assert.equal((await driveRetry({ request: request("/api/admin/drive", { method: "POST", body: '{"action":"drop"}', cookie: session }), env: env as never, params: {} })).status, 400);
  const unconfigured = makeEnv({ GOOGLE_DRIVE_REFRESH_TOKEN: undefined });
  assert.equal((await driveRetry({ request: request("/api/admin/drive", { method: "POST", body: '{"action":"selftest"}', cookie: session }), env: unconfigured as never, params: {} })).status, 409);
  fakeDrive.oauth = "invalid_grant";
  const failed = await driveRetry({ request: request("/api/admin/drive", { method: "POST", body: '{"action":"selftest"}', cookie: session }), env: env as never, params: {} });
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { ok: false, reason: "selftest_failed", code: "oauth_invalid_grant" });
});
