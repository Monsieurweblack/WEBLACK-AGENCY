/**
 * Tests de l'administration réelle (routes functions/api/admin/*) contre la
 * base SQLite de test et le KV en mémoire : authentification, expiration,
 * révocation à la déconnexion, contrôles par ressource, paramètres
 * malformés. Aucun secret réel : un secret de session factice est généré
 * ici.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as login } from "../api/admin/login.ts";
import { onRequestPost as logout } from "../api/admin/logout.ts";
import { onRequestGet as listApplications } from "../api/admin/applications.ts";
import { onRequestGet as getApplication, onRequestPatch as patchApplication } from "../api/admin/applications/[id].ts";
import { onRequestGet as getPhoto } from "../api/admin/photo/[photoId].ts";
import { onRequestGet as emailSummary, onRequestPost as retryEmails } from "../api/admin/emails.ts";
import { onRequestPost as submit } from "../api/talent-application/submit.ts";
import { createSessionCookie } from "./adminSession.ts";
import { TEST_PHOTO_IDS, validPayload } from "./testFixtures.ts";
import { FakeKV, network, seedPhotos, SqliteD1 } from "./testDoubles.ts";

const SECRET = crypto.randomUUID() + crypto.randomUUID();
const PASSWORD = `pw-${crypto.randomUUID()}`;
let ip = 0;

function makeEnv() {
  return {
    DB: new SqliteD1(),
    PHOTOS: new FakeKV(),
    ADMIN_SESSION_SECRET: SECRET,
    ADMIN_PASSWORD: PASSWORD,
    SANITY_PROJECT_ID: "test",
    SANITY_DATASET: "test",
    NEWSLETTER_API_KEY: "test-key",
    RESEND_FROM: "talents@weblack.test",
  };
}
type Env = ReturnType<typeof makeEnv>;

function request(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  ip += 1;
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", `10.3.${Math.floor(ip / 250)}.${ip % 250}`);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(`https://weblack.test${path}`, { ...init, headers });
}

const cookieValue = (setCookie: string) => setCookie.split(";")[0]!;

async function sessionCookie(issuedAt?: number): Promise<string> {
  const realNow = Date.now;
  if (issuedAt !== undefined) Date.now = () => issuedAt;
  try {
    return cookieValue(await createSessionCookie(SECRET));
  } finally {
    Date.now = realNow;
  }
}

async function seedApplication(env: Env): Promise<string> {
  await seedPhotos(env.PHOTOS, [TEST_PHOTO_IDS.portrait, TEST_PHOTO_IDS.profile, TEST_PHOTO_IDS.fullLength]);
  const response = await submit({ request: request("/api/talent-application/submit", { method: "POST", body: JSON.stringify(validPayload()) }), env: env as never, params: {} });
  assert.equal(response.status, 200);
  return env.DB.rows<{ id: string }>(`SELECT id FROM applications`)[0]!.id;
}

beforeEach(() => network.reset());

test("admin — accès non authentifié refusé sur chaque route (liste, dossier, photo, e-mails)", async () => {
  const env = makeEnv();
  const id = await seedApplication(env);
  const calls = [
    listApplications({ request: request("/api/admin/applications"), env: env as never, params: {} }),
    getApplication({ request: request(`/api/admin/applications/${id}`), env: env as never, params: { id } }),
    patchApplication({ request: request(`/api/admin/applications/${id}`, { method: "PATCH", body: '{"status":"REJECTED"}' }), env: env as never, params: { id } }),
    getPhoto({ request: request(`/api/admin/photo/${TEST_PHOTO_IDS.portrait}`), env: env as never, params: { photoId: TEST_PHOTO_IDS.portrait } }),
    emailSummary({ request: request("/api/admin/emails"), env: env as never, params: {} }),
    retryEmails({ request: request("/api/admin/emails", { method: "POST" }), env: env as never, params: {} }),
  ];
  for (const response of await Promise.all(calls)) assert.equal(response.status, 401);
  assert.equal(env.DB.rows<{ status: string }>(`SELECT status FROM applications`)[0]!.status, "RECEIVED", "aucune modification");
});

test("admin — connexion : mauvais mot de passe 401, bon mot de passe → cookie HttpOnly/Secure/SameSite=Strict", async () => {
  const env = makeEnv();
  const wrong = await login({ request: request("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "nope" }) }), env: env as never, params: {} });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("Set-Cookie"), null);
  const ok = await login({ request: request("/api/admin/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), env: env as never, params: {} });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("Set-Cookie")!;
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(cookie.includes(flag), flag);
});

test("admin — tentatives de connexion abusives limitées (429)", async () => {
  const env = makeEnv();
  const attempt = () =>
    login({
      request: new Request("https://weblack.test/api/admin/login", { method: "POST", body: '{"password":"x"}', headers: { "CF-Connecting-IP": "10.8.8.8" } }),
      env: env as never,
      params: {},
    });
  for (let i = 0; i < 10; i++) await attempt();
  assert.equal((await attempt()).status, 429);
});

test("admin — session valide acceptée : liste, dossier avec état des e-mails, photo rattachée", async () => {
  const env = makeEnv();
  const id = await seedApplication(env);
  const cookie = await sessionCookie();

  const list = await listApplications({ request: request("/api/admin/applications", { cookie }), env: env as never, params: {} });
  assert.equal(list.status, 200);
  assert.equal(((await list.json()) as { applications: unknown[] }).applications.length, 1);

  const detail = await getApplication({ request: request(`/api/admin/applications/${id}`, { cookie }), env: env as never, params: { id } });
  const body = (await detail.json()) as { photos: { url: string }[]; emails: { kind: string; status: string }[] };
  assert.equal(body.photos.length, 3);
  assert.deepEqual(body.emails.map((e) => [e.kind, e.status]), [["admin_notification", "sent"], ["candidate_confirmation", "sent"]]);

  const photo = await getPhoto({ request: request(body.photos[0]!.url, { cookie }), env: env as never, params: { photoId: body.photos[0]!.url.split("/").pop()! } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("Cache-Control"), "private, no-store");
});

test("admin — session expirée refusée", async () => {
  const env = makeEnv();
  const cookie = await sessionCookie(Date.now() - 13 * 60 * 60 * 1000);
  const response = await listApplications({ request: request("/api/admin/applications", { cookie }), env: env as never, params: {} });
  assert.equal(response.status, 401);
});

test("admin — cookie falsifié refusé", async () => {
  const env = makeEnv();
  const genuine = await sessionCookie();
  const forged = genuine.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  const response = await listApplications({ request: request("/api/admin/applications", { cookie: forged }), env: env as never, params: {} });
  assert.equal(response.status, 401);
});

test("admin — après déconnexion, le même cookie est refusé côté serveur", async () => {
  const env = makeEnv();
  const cookie = await sessionCookie();
  const out = await logout({ request: request("/api/admin/logout", { method: "POST", cookie }), env: env as never, params: {} });
  assert.ok(out.headers.get("Set-Cookie")!.includes("Max-Age=0"));
  const reused = await listApplications({ request: request("/api/admin/applications", { cookie }), env: env as never, params: {} });
  assert.equal(reused.status, 401);
});

test("admin — paramètres et filtres malformés traités proprement (400), dossier inconnu 404", async () => {
  const env = makeEnv();
  const cookie = await sessionCookie();
  const badFilter = await listApplications({ request: request("/api/admin/applications?status=1%27%20OR%201%3D1", { cookie }), env: env as never, params: {} });
  assert.equal(badFilter.status, 400);
  const badId = await getApplication({ request: request("/api/admin/applications/x", { cookie }), env: env as never, params: { id: "' OR 1=1 --" } });
  assert.equal(badId.status, 400);
  const unknown = "99999999-9999-4999-8999-999999999999";
  assert.equal((await getApplication({ request: request(`/api/admin/applications/${unknown}`, { cookie }), env: env as never, params: { id: unknown } })).status, 404);
  const badPatch = await patchApplication({
    request: request(`/api/admin/applications/${unknown}`, { method: "PATCH", body: '{"status":"HACKED"}', cookie }),
    env: env as never,
    params: { id: unknown },
  });
  assert.equal(badPatch.status, 400);
  const badPhoto = await getPhoto({ request: request("/api/admin/photo/x", { cookie }), env: env as never, params: { photoId: "../../etc/passwd" } });
  assert.equal(badPhoto.status, 400);
});

test("admin — une photo envoyée mais non rattachée à un dossier n'est servie à personne, même connecté", async () => {
  const env = makeEnv();
  const orphan = "77777777-7777-4777-8777-777777777777";
  await seedPhotos(env.PHOTOS, [orphan]);
  const cookie = await sessionCookie();
  const response = await getPhoto({ request: request(`/api/admin/photo/${orphan}`, { cookie }), env: env as never, params: { photoId: orphan } });
  assert.equal(response.status, 404);
});

test("admin — suivi des e-mails : résumé sans donnée personnelle, relance manuelle", async () => {
  network.resend = "server_error";
  const env = makeEnv();
  await seedApplication(env);
  const cookie = await sessionCookie();

  const summary = await emailSummary({ request: request("/api/admin/emails", { cookie }), env: env as never, params: {} });
  const text = await summary.text();
  assert.ok(text.includes('"failed"') && !text.includes("awa@example.com") && !text.includes("Diallo"));

  network.resend = "ok";
  const retry = await retryEmails({ request: request("/api/admin/emails", { method: "POST", cookie }), env: env as never, params: {} });
  const body = (await retry.json()) as { outcomes: Record<string, number> };
  assert.equal(body.outcomes.sent, 2);
  assert.ok(env.DB.rows<{ status: string }>(`SELECT status FROM email_outbox`).every((r) => r.status === "sent"));
});
