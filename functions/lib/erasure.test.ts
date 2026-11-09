/**
 * Droit à l'effacement : effacement complet d'une personne (candidatures,
 * photos, historique, e-mails, demandes commerciales), garde de
 * confirmation, arrêt sans perte si l'archive Drive ne peut pas partir à la
 * corbeille. Base SQLite en mémoire, KV en mémoire, aucun appel réel.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as submitApplication } from "../api/talent-application/submit.ts";
import { onRequestPost as submitInquiry } from "../api/business-inquiry.ts";
import { onRequestPost as erase } from "../api/admin/contacts/erase.ts";
import { onRequestDelete as deleteApplication } from "../api/admin/applications/[id].ts";
import { createSessionCookie } from "./adminSession.ts";
import { contactKey } from "./contacts.ts";
import { validPayload } from "./testFixtures.ts";
import { FakeKV, network, seedPhotos, SqliteD1 } from "./testDoubles.ts";

const SECRET = "erasure-test-session-secret-0123456789";
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

function req(url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  ip += 1;
  const headers = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": `10.88.${Math.floor(ip / 250)}.${ip % 250}` });
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(`https://weblack.test${url}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const cookie = async () => (await createSessionCookie(SECRET)).split(";")[0]!;

async function application(env: Env, email: string) {
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await seedPhotos(env.PHOTOS, ids);
  const payload = validPayload({ email, submissionId: crypto.randomUUID() });
  payload.photoIds = { portrait: [ids[0]], profile: [ids[1]], full_length: [ids[2]] };
  const r = await submitApplication({ request: req("/api/talent-application/submit", { method: "POST", body: payload }), env, params: {} } as never);
  assert.equal(r.status, 200);
  return { id: String(env.DB.rows<{ id: string }>(`SELECT id FROM applications ORDER BY created_at DESC LIMIT 1`)[0]!.id), photos: ids };
}

async function inquiry(env: Env, email: string) {
  const r = await submitInquiry({
    request: req("/api/business-inquiry", {
      method: "POST",
      body: { submissionId: crypto.randomUUID(), lang: "fr", division: "talent", service: "connection", fullName: "Test Exemple", email, country: "SN", description: "Demande fictive pour vérifier l'effacement complet d'un contact." },
    }),
    env,
    params: {},
  } as never);
  assert.equal(r.status, 200);
}

const post = async (env: Env, body: unknown, withCookie = true) => {
  const r = await erase({ request: req("/api/admin/contacts/erase", { method: "POST", body, cookie: withCookie ? await cookie() : undefined }), env, params: {} } as never);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

beforeEach(() => network.reset());

test("effacement — candidature, photos, historique, e-mails et demandes d'une personne ; les autres intactes ; audit sous empreinte", async () => {
  const env = makeEnv();
  const target = await application(env, "Effacer@Example.org");
  await inquiry(env, "effacer@example.org");
  const other = await application(env, "garder@example.org");
  const r = await post(env, { email: "effacer@example.org", confirm: "EFFACER@example.org" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.applicationsDeleted, 1);
  assert.equal(r.body.inquiriesDeleted, 1);
  assert.equal(env.DB.rows(`SELECT * FROM applications WHERE id = ?`, target.id).length, 0);
  assert.equal(env.DB.rows(`SELECT * FROM application_photos WHERE application_id = ?`, target.id).length, 0);
  assert.equal(env.DB.rows(`SELECT * FROM email_outbox WHERE application_id = ?`, target.id).length, 0);
  assert.equal(env.DB.rows(`SELECT * FROM business_inquiries`).length, 0);
  for (const id of target.photos) assert.equal(env.PHOTOS.store.has(`photo:${id}`), false);
  // L'autre personne n'est pas touchée.
  assert.equal(env.DB.rows(`SELECT * FROM applications WHERE id = ?`, other.id).length, 1);
  for (const id of other.photos) assert.equal(env.PHOTOS.store.has(`photo:${id}`), true);
  const audit = env.DB.rows<{ action: string; target_id: string; detail: string }>(`SELECT action, target_id, detail FROM admin_audit WHERE action = 'contact.erase'`);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.target_id, await contactKey("effacer@example.org"));
  assert.equal(audit[0]!.detail, "applications=1,inquiries=1");
  assert.equal(JSON.stringify(env.DB.rows(`SELECT * FROM admin_audit`)).includes("@"), false);
});

test("effacement — confirmation obligatoire, adresse invalide, contact inconnu, sans session", async () => {
  const env = makeEnv();
  await application(env, "awa@example.com");
  assert.equal((await post(env, { email: "awa@example.com" })).body.reason, "confirmation_mismatch");
  assert.equal((await post(env, { email: "awa@example.com", confirm: "autre@example.com" })).status, 400);
  assert.equal((await post(env, { email: "pas-une-adresse", confirm: "pas-une-adresse" })).status, 400);
  assert.equal((await post(env, { email: "inconnu@example.org", confirm: "inconnu@example.org" })).status, 404);
  assert.equal((await post(env, { email: "awa@example.com", confirm: "awa@example.com" }, false)).status, 401);
  assert.equal(env.DB.rows(`SELECT * FROM applications`).length, 1);
});

test("effacement — archive Drive impossible à mettre à la corbeille : rien n'est supprimé, l'opération reste relançable", async () => {
  const env = makeEnv();
  const target = await application(env, "drive@example.org");
  env.DB.db.prepare(`UPDATE drive_sync SET folder_id = 'folder-123' WHERE application_id = ?`).run(target.id);
  // Drive non configuré dans cet environnement : la mise en corbeille est impossible.
  const r = await post(env, { email: "drive@example.org", confirm: "drive@example.org" });
  assert.equal(r.status, 502);
  assert.equal(r.body.reason, "partial");
  assert.equal(r.body.applicationsDeleted, 0);
  assert.equal(env.DB.rows(`SELECT * FROM applications WHERE id = ?`, target.id).length, 1);
  for (const id of target.photos) assert.equal(env.PHOTOS.store.has(`photo:${id}`), true);
  // La suppression individuelle applique la même règle.
  const single = await deleteApplication({ request: req(`/api/admin/applications/${target.id}`, { method: "DELETE", cookie: await cookie() }), env, params: { id: target.id } } as never);
  assert.equal(single.status, 409);
});
