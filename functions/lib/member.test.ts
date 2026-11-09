/**
 * Espace membre (lien magique) : énumération impossible, jeton à usage
 * unique et expirant, session signée et révocable, origine croisée refusée,
 * profil privé sans notes internes, mise à jour validée et tracée, niveaux
 * déduits des statuts, demande et exécution de l'effacement.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as submitApplication } from "../api/talent-application/submit.ts";
import { onRequestPost as requestLink } from "../api/member/request-link.ts";
import { onRequestPost as verify } from "../api/member/verify.ts";
import { onRequestGet as me, onRequestPatch as patchMe } from "../api/member/me.ts";
import { onRequestPost as logout } from "../api/member/logout.ts";
import { onRequestPost as erasureRequest } from "../api/member/erasure-request.ts";
import { onRequestPatch as adminPatch } from "../api/admin/applications/[id].ts";
import { onRequestPost as adminErase } from "../api/admin/contacts/erase.ts";
import { onRequestGet as metrics } from "../api/admin/metrics.ts";
import { createSessionCookie } from "./adminSession.ts";
import { consumeLoginToken, createLoginToken, levelOf, LOGIN_TOKEN_TTL_MS } from "./member.ts";
import { validPayload } from "./testFixtures.ts";
import { FakeKV, network, seedPhotos, SqliteD1 } from "./testDoubles.ts";

const SECRET = "member-test-session-secret-0123456789";
let ip = 0;
const makeEnv = () => ({
  DB: new SqliteD1(),
  PHOTOS: new FakeKV(),
  SANITY_PROJECT_ID: "test",
  SANITY_DATASET: "test",
  NEWSLETTER_API_KEY: "test-key",
  RESEND_FROM: "WEBLACK <talents@weblack.test>",
  ADMIN_SESSION_SECRET: SECRET,
  APP_ENV: "preview",
});
type Env = ReturnType<typeof makeEnv>;
const HOST = "https://weblack.test";

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  ip += 1;
  const headers = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": `10.99.${Math.floor(ip / 250)}.${ip % 250}` });
  if (init.origin !== null) headers.set("Origin", init.origin ?? HOST);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(`${HOST}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const call = async (h: (c: never) => Promise<Response>, env: Env, path: string, init: Parameters<typeof req>[1] = {}, params: Record<string, string> = {}) => {
  const r = await h({ request: req(path, init), env, params } as never);
  return { status: r.status, headers: r.headers, body: (await r.json()) as Record<string, any> };
};

async function application(env: Env, email: string) {
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await seedPhotos(env.PHOTOS, ids);
  const payload = validPayload({ email, submissionId: crypto.randomUUID() });
  payload.photoIds = { portrait: [ids[0]], profile: [ids[1]], full_length: [ids[2]] };
  const r = await call(submitApplication as never, env, "/api/talent-application/submit", { method: "POST", body: payload });
  assert.equal(r.status, 200);
  return String(env.DB.rows<{ id: string }>(`SELECT id FROM applications ORDER BY created_at DESC LIMIT 1`)[0]!.id);
}

/** Connexion complète par lien : renvoie le cookie de session. */
async function signIn(env: Env, email: string) {
  const token = await createLoginToken(env.DB as never, email);
  const r = await call(verify as never, env, "/api/member/verify", { method: "POST", body: { token } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.headers.get("Set-Cookie")!.split(";")[0]!;
}

beforeEach(() => network.reset());

test("lien — réponse identique pour une adresse inconnue ; un seul e-mail, et seulement pour une adresse connue", async () => {
  const env = makeEnv();
  await application(env, "awa@example.com");
  network.sent = [];
  const unknown = await call(requestLink as never, env, "/api/member/request-link", { method: "POST", body: { email: "inconnu@example.org" } });
  const known = await call(requestLink as never, env, "/api/member/request-link", { method: "POST", body: { email: "Awa@Example.com", lang: "en" } });
  assert.deepEqual(unknown.body, { ok: true });
  assert.deepEqual(known.body, { ok: true });
  assert.equal(env.DB.rows(`SELECT * FROM member_login_tokens`).length, 1);
  assert.equal(network.sent.length, 1);
  assert.equal(network.sent[0]!.to, "awa@example.com");
  assert.match(network.sent[0]!.text, /https:\/\/weblack\.test\/en\/espace\/#t=[A-Za-z0-9_-]{43}/);
  // Le jeton n'est jamais stocké en clair.
  const stored = env.DB.rows<{ token_hash: string }>(`SELECT token_hash FROM member_login_tokens`)[0]!;
  const token = network.sent[0]!.text.match(/#t=([A-Za-z0-9_-]+)/)![1]!;
  assert.notEqual(stored.token_hash, token);
  assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
});

test("lien — origine croisée refusée, adresse invalide, débit par adresse (3/h) sans révéler de différence", async () => {
  const env = makeEnv();
  await application(env, "awa@example.com");
  assert.equal((await call(requestLink as never, env, "/api/member/request-link", { method: "POST", body: { email: "awa@example.com" }, origin: "https://evil.example" })).status, 403);
  assert.equal((await call(requestLink as never, env, "/api/member/request-link", { method: "POST", body: { email: "awa@example.com" }, origin: null })).status, 403);
  assert.equal((await call(requestLink as never, env, "/api/member/request-link", { method: "POST", body: { email: "pas-une-adresse" } })).status, 400);
  network.sent = [];
  for (let i = 0; i < 5; i++) {
    const r = await call(requestLink as never, env, "/api/member/request-link", { method: "POST", body: { email: "awa@example.com" } });
    assert.deepEqual(r.body, { ok: true });
  }
  assert.equal(network.sent.length, 3);
});

test("jeton — usage unique, expiration à 15 minutes, jeton forgé refusé", async () => {
  const env = makeEnv();
  await application(env, "awa@example.com");
  const t0 = Date.now();
  const token = await createLoginToken(env.DB as never, "awa@example.com", t0);
  assert.equal(await consumeLoginToken(env.DB as never, token, t0 + LOGIN_TOKEN_TTL_MS + 1), null);
  const fresh = await createLoginToken(env.DB as never, "awa@example.com", t0);
  assert.equal(await consumeLoginToken(env.DB as never, fresh, t0 + 1000), "awa@example.com");
  assert.equal(await consumeLoginToken(env.DB as never, fresh, t0 + 2000), null);
  const forged = await call(verify as never, env, "/api/member/verify", { method: "POST", body: { token: "A".repeat(43) } });
  assert.equal(forged.status, 401);
  assert.equal(forged.headers.get("Set-Cookie"), null);
});

test("session — cookie HttpOnly/Secure/Lax sans adresse ; falsifié refusé ; déconnexion révoque côté serveur", async () => {
  const env = makeEnv();
  await application(env, "awa@example.com");
  const token = await createLoginToken(env.DB as never, "awa@example.com");
  const r = await call(verify as never, env, "/api/member/verify", { method: "POST", body: { token } });
  const setCookie = r.headers.get("Set-Cookie")!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.equal(setCookie.includes("awa"), false);
  const cookie = setCookie.split(";")[0]!;
  assert.equal((await call(me as never, env, "/api/member/me", { cookie })).status, 200);
  const tampered = cookie.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  assert.equal((await call(me as never, env, "/api/member/me", { cookie: tampered })).status, 401);
  // Un cookie d'administration n'ouvre pas l'espace membre, et inversement la clé est distincte.
  const admin = (await createSessionCookie(SECRET)).split(";")[0]!.replace("weblack_admin_session", "weblack_member_session");
  assert.equal((await call(me as never, env, "/api/member/me", { cookie: admin })).status, 401);
  await call(logout as never, env, "/api/member/logout", { method: "POST", cookie });
  assert.equal((await call(me as never, env, "/api/member/me", { cookie })).status, 401);
});

test("profil — vue privée sans notes internes ; niveaux candidat → activé → représenté", async () => {
  const env = makeEnv();
  const id = await application(env, "awa@example.com");
  const admin = (await createSessionCookie(SECRET)).split(";")[0]!;
  await call(adminPatch as never, env, `/api/admin/applications/${id}`, { method: "PATCH", body: { status: "SHORTLISTED", notes: "Note interne confidentielle" }, cookie: admin }, { id });
  const cookie = await signIn(env, "awa@example.com");
  const view = await call(me as never, env, "/api/member/me", { cookie });
  assert.equal(view.body.level, "candidate");
  assert.equal(view.body.applications[0].status, "in_progress");
  assert.equal(JSON.stringify(view.body).includes("confidentielle"), false);
  assert.equal(JSON.stringify(view.body).includes("SHORTLISTED"), false);
  await call(adminPatch as never, env, `/api/admin/applications/${id}`, { method: "PATCH", body: { status: "TALENT_POOL" }, cookie: admin }, { id });
  assert.equal((await call(me as never, env, "/api/member/me", { cookie })).body.level, "activated");
  await call(adminPatch as never, env, `/api/admin/applications/${id}`, { method: "PATCH", body: { status: "REPRESENTED" }, cookie: admin }, { id });
  assert.equal((await call(me as never, env, "/api/member/me", { cookie })).body.level, "represented");
  assert.equal(levelOf(["REJECTED", "SELECTED"]), "activated");
});

test("profil — mise à jour validée, tracée sans valeurs, origine croisée refusée", async () => {
  const env = makeEnv();
  const id = await application(env, "awa@example.com");
  const cookie = await signIn(env, "awa@example.com");
  const bad = await call(patchMe as never, env, "/api/member/me", { method: "PATCH", body: { phone: "123", portfolioLinks: ["javascript:alert(1)"], contactPref: "fax" }, cookie });
  assert.equal(bad.status, 422);
  assert.deepEqual((bad.body.errors as { field: string }[]).map((e) => e.field).sort(), ["contactPref", "phone", "portfolioLinks"]);
  const cross = await call(patchMe as never, env, "/api/member/me", { method: "PATCH", body: { city: "Lyon" }, cookie, origin: "https://evil.example" });
  assert.equal(cross.status, 403);
  const ok = await call(
    patchMe as never,
    env,
    "/api/member/me",
    { method: "PATCH", body: { phone: "+221 77 123 45 67", city: "Dakar", availability: "Disponible dès mars", contactPref: "email", portfolioLinks: ["https://portfolio.example/awa"] }, cookie },
  );
  assert.equal(ok.status, 200);
  const row = { ...env.DB.rows<Record<string, unknown>>(`SELECT phone, city, member_availability, member_contact_pref, portfolio_links FROM applications WHERE id = ?`, id)[0]! };
  assert.deepEqual(row, { phone: "+221771234567", city: "Dakar", member_availability: "Disponible dès mars", member_contact_pref: "email", portfolio_links: "https://portfolio.example/awa" });
  const note = env.DB.rows<{ note: string }>(`SELECT note FROM application_events WHERE application_id = ? AND kind = 'note'`, id).at(-1)!;
  assert.match(note.note, /Mise à jour par la personne/);
  assert.equal(note.note.includes("Dakar"), false);
  const audit = env.DB.rows<{ action: string; detail: string }>(`SELECT action, detail FROM admin_audit WHERE action = 'member.update'`);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.detail.includes("Dakar"), false);
});

test("effacement — demandé par la personne (signalé, rien supprimé), puis exécuté : sessions et liens effacés", async () => {
  const env = makeEnv();
  await application(env, "awa@example.com");
  const cookie = await signIn(env, "awa@example.com");
  await createLoginToken(env.DB as never, "awa@example.com");
  const asked = await call(erasureRequest as never, env, "/api/member/erasure-request", { method: "POST", cookie });
  assert.equal(asked.status, 200);
  assert.equal(env.DB.rows(`SELECT * FROM applications`).length, 1);
  const admin = (await createSessionCookie(SECRET)).split(";")[0]!;
  assert.equal((await call(metrics as never, env, "/api/admin/metrics", { cookie: admin })).body.operations.pendingErasureRequests, 1);
  const erased = await call(adminErase as never, env, "/api/admin/contacts/erase", { method: "POST", body: { email: "awa@example.com", confirm: "awa@example.com" }, cookie: admin });
  assert.equal(erased.status, 200);
  assert.equal(env.DB.rows(`SELECT * FROM member_sessions`).length, 0);
  assert.equal(env.DB.rows(`SELECT * FROM member_login_tokens`).length, 0);
  assert.equal((await call(me as never, env, "/api/member/me", { cookie })).status, 401);
  assert.equal((await call(metrics as never, env, "/api/admin/metrics", { cookie: admin })).body.operations.pendingErasureRequests, 0);
});

test("lien — garde-fou : liaisons de production hors weblack.fr refusées", async () => {
  const env = { ...makeEnv(), APP_ENV: "production" };
  const r = await requestLink({ request: new Request("https://abc.weblack.pages.dev/api/member/request-link", { method: "POST", headers: { Origin: "https://abc.weblack.pages.dev", "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@example.com" }) }), env, params: {} } as never);
  assert.equal(r.status, 503);
});
