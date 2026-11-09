/**
 * Relationship Engine v1 : cycle de vie Talent (historique, audit,
 * recherche), pipeline commercial (prochaine action, valeur estimée),
 * contacts dédupliqués, export RGPD et tableau de bord. Base SQLite en
 * mémoire portant les migrations du dépôt ; aucun appel réel.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as submitApplication } from "../api/talent-application/submit.ts";
import { onRequestPost as submitInquiry } from "../api/business-inquiry.ts";
import { onRequestGet as listApplications } from "../api/admin/applications.ts";
import { onRequestGet as getApplication, onRequestPatch as patchApplication, onRequestDelete as deleteApplication } from "../api/admin/applications/[id].ts";
import { onRequestPatch as patchInquiry } from "../api/admin/inquiries/[id].ts";
import { onRequestGet as listContactsApi } from "../api/admin/contacts.ts";
import { onRequestPost as exportContactApi } from "../api/admin/contacts/export.ts";
import { onRequestGet as metricsApi } from "../api/admin/metrics.ts";
import { createSessionCookie } from "./adminSession.ts";
import { validPayload } from "./testFixtures.ts";
import { FakeKV, network, seedPhotos, SqliteD1 } from "./testDoubles.ts";

const SECRET = "engine-test-session-secret-0123456789";
let ip = 0;

function makeEnv() {
  return {
    DB: new SqliteD1(),
    PHOTOS: new FakeKV(),
    SANITY_PROJECT_ID: "test",
    SANITY_DATASET: "test",
    NEWSLETTER_API_KEY: "test-key",
    RESEND_FROM: "WEBLACK <talents@weblack.test>",
    ADMIN_SESSION_SECRET: SECRET,
    APP_ENV: "preview",
  };
}
type Env = ReturnType<typeof makeEnv>;

function req(url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  ip += 1;
  const headers = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": `10.77.${Math.floor(ip / 250)}.${ip % 250}` });
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(`https://weblack.test${url}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const cookie = async () => (await createSessionCookie(SECRET)).split(";")[0]!;
const call = async (handler: (ctx: never) => Promise<Response>, env: Env, url: string, init: Parameters<typeof req>[1] = {}, params: Record<string, string> = {}) => {
  const r = await handler({ request: req(url, init), env, params } as never);
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};

async function newApplication(env: Env, email = "awa@example.com", extra: Record<string, unknown> = {}) {
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await seedPhotos(env.PHOTOS, ids);
  const payload = validPayload({ email, submissionId: crypto.randomUUID(), ...extra });
  payload.photoIds = { portrait: [ids[0]], profile: [ids[1]], full_length: [ids[2]] };
  const r = await call(submitApplication as never, env, "/api/talent-application/submit", { method: "POST", body: payload });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return String(env.DB.rows<{ id: string }>(`SELECT id FROM applications ORDER BY created_at DESC LIMIT 1`)[0]!.id);
}

async function newInquiry(env: Env, email: string, over: Record<string, unknown> = {}) {
  const r = await call(submitInquiry as never, env, "/api/business-inquiry", {
    method: "POST",
    body: {
      submissionId: crypto.randomUUID(),
      lang: "fr",
      division: "creative",
      service: "campaign",
      fullName: "Prospect Exemple",
      email,
      organisation: "Maison Exemple",
      country: "FR",
      description: "Campagne fictive de test pour vérifier le pipeline commercial.",
      ...over,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return String(env.DB.rows<{ id: string }>(`SELECT id FROM business_inquiries ORDER BY created_at DESC LIMIT 1`)[0]!.id);
}

beforeEach(() => network.reset());

test("talent — changement de statut : historique + audit dans la même transaction, nouveaux statuts acceptés", async () => {
  const env = makeEnv();
  const id = await newApplication(env);
  const c = await cookie();
  for (const status of ["REVIEWING", "INFO_REQUESTED", "INTERVIEW", "SELECTED", "TALENT_POOL", "REPRESENTED"]) {
    const r = await call(patchApplication as never, env, `/api/admin/applications/${id}`, { method: "PATCH", body: { status }, cookie: c }, { id });
    assert.equal(r.status, 200, status);
  }
  const bad = await call(patchApplication as never, env, `/api/admin/applications/${id}`, { method: "PATCH", body: { status: "HIRED" }, cookie: c }, { id });
  assert.equal(bad.status, 400);
  await call(patchApplication as never, env, `/api/admin/applications/${id}`, { method: "PATCH", body: { notes: "Book reçu." }, cookie: c }, { id });
  const detail = await call(getApplication as never, env, `/api/admin/applications/${id}`, { cookie: c }, { id });
  const events = detail.body.events as { kind: string; from_status: string; to_status: string; note: string }[];
  assert.equal(events.filter((e) => e.kind === "status").length, 6);
  assert.ok(events.some((e) => e.kind === "note" && e.note === "Book reçu."));
  const audit = env.DB.rows<{ action: string; detail: string; target_id: string }>(`SELECT action, detail, target_id FROM admin_audit`);
  assert.equal(audit.filter((a) => a.action === "application.status").length, 6);
  assert.ok(audit.some((a) => a.detail === "RECEIVED → REVIEWING"));
  // Le journal d'audit ne contient jamais l'adresse e-mail.
  assert.equal(JSON.stringify(audit).includes("@"), false);
});

test("talent — suppression : dossier, historique et photos effacés, suppression auditée", async () => {
  const env = makeEnv();
  const id = await newApplication(env);
  const c = await cookie();
  await call(patchApplication as never, env, `/api/admin/applications/${id}`, { method: "PATCH", body: { status: "REJECTED" }, cookie: c }, { id });
  const r = await call(deleteApplication as never, env, `/api/admin/applications/${id}`, { method: "DELETE", cookie: c }, { id });
  assert.equal(r.status, 200);
  assert.equal(env.DB.rows(`SELECT * FROM applications`).length, 0);
  assert.equal(env.DB.rows(`SELECT * FROM application_events`).length, 0);
  assert.equal(env.DB.rows(`SELECT * FROM admin_audit WHERE action = 'application.delete'`).length, 1);
});

test("talent — recherche multicritère : texte, catégorie, pays, statut ; paramètres invalides ignorés", async () => {
  const env = makeEnv();
  await newApplication(env, "awa@example.com");
  await newApplication(env, "kofi@example.com", { firstName: "Kofi", lastName: "Mensah", city: "Accra", country: "GH", category: "photo" });
  const c = await cookie();
  const q = async (qs: string) => ((await call(listApplications as never, env, `/api/admin/applications${qs}`, { cookie: c })).body.applications as { first_name: string }[]).map((a) => a.first_name);
  assert.deepEqual(await q("?q=accra"), ["Kofi"]);
  assert.deepEqual(await q("?country=GH"), ["Kofi"]);
  assert.deepEqual(await q("?category=photo"), ["Kofi"]);
  assert.equal((await q("")).length, 2);
  assert.equal((await q("?country=ghana")).length, 2);
  assert.equal((await q("?q=%25")).length, 2);
  assert.equal((await q("?status=RECEIVED&q=kofi")).length, 1);
});

test("commercial — prochaine action, date, valeur estimée, secteur ; validation stricte ; audit sans donnée personnelle", async () => {
  const env = makeEnv();
  const id = await newInquiry(env, "prospect@example.org");
  const c = await cookie();
  const ok = await call(
    patchInquiry as never,
    env,
    `/api/admin/inquiries/${id}`,
    { method: "PATCH", body: { status: "MEETING", nextAction: "Envoyer le devis", nextActionAt: "2026-11-20", estimatedValue: 12000, sector: "Mode" }, cookie: c },
    { id },
  );
  assert.equal(ok.status, 200);
  const row = { ...env.DB.rows<Record<string, unknown>>(`SELECT status, next_action, next_action_at, estimated_value, sector FROM business_inquiries`)[0]! };
  assert.deepEqual(row, { status: "MEETING", next_action: "Envoyer le devis", next_action_at: "2026-11-20", estimated_value: 12000, sector: "Mode" });
  for (const body of [{ nextActionAt: "20/11/2026" }, { estimatedValue: -5 }, { estimatedValue: 1.5 }, { estimatedValue: "12000" }, { status: "HIRED" }]) {
    const r = await call(patchInquiry as never, env, `/api/admin/inquiries/${id}`, { method: "PATCH", body, cookie: c }, { id });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const cleared = await call(patchInquiry as never, env, `/api/admin/inquiries/${id}`, { method: "PATCH", body: { nextAction: null, nextActionAt: null }, cookie: c }, { id });
  assert.equal(cleared.status, 200);
  assert.equal(env.DB.rows<{ next_action: null }>(`SELECT next_action FROM business_inquiries`)[0]!.next_action, null);
  const audit = env.DB.rows<{ action: string }>(`SELECT action, detail FROM admin_audit`);
  assert.ok(audit.some((a) => a.action === "inquiry.status"));
  assert.ok(audit.some((a) => a.action === "inquiry.pipeline"));
  assert.equal(JSON.stringify(audit).includes("@"), false);
});

test("contacts — une personne par adresse (casse ignorée), segments déduits des faits", async () => {
  const env = makeEnv();
  await newApplication(env, "Awa@Example.com");
  const inquiryId = await newInquiry(env, "awa@example.com");
  await newInquiry(env, "client@example.org");
  const c = await cookie();
  await call(patchInquiry as never, env, `/api/admin/inquiries/${inquiryId}`, { method: "PATCH", body: { status: "WON" }, cookie: c }, { id: inquiryId });
  const r = await call(listContactsApi as never, env, "/api/admin/contacts", { cookie: c });
  const contacts = r.body.contacts as { email: string; segments: string[]; applications: unknown[]; inquiries: unknown[]; key: string }[];
  assert.equal(contacts.length, 2);
  const awa = contacts.find((x) => x.email === "awa@example.com")!;
  assert.equal(awa.applications.length, 1);
  assert.equal(awa.inquiries.length, 1);
  assert.deepEqual(awa.segments.sort(), ["client", "talent_applicant"]);
  assert.match(awa.key, /^[0-9a-f]{16}$/);
  assert.deepEqual(contacts.find((x) => x.email === "client@example.org")!.segments, ["prospect"]);
  const filtered = await call(listContactsApi as never, env, "/api/admin/contacts?q=client", { cookie: c });
  assert.equal((filtered.body.contacts as unknown[]).length, 1);
  const unauth = await call(listContactsApi as never, env, "/api/admin/contacts");
  assert.equal(unauth.status, 401);
});

test("export RGPD — tout ce que la base détient, POST uniquement, audité sous empreinte", async () => {
  const env = makeEnv();
  const appId = await newApplication(env, "awa@example.com");
  await newInquiry(env, "AWA@example.com");
  const c = await cookie();
  await call(patchApplication as never, env, `/api/admin/applications/${appId}`, { method: "PATCH", body: { status: "REVIEWING" }, cookie: c }, { id: appId });
  const r = await call(exportContactApi as never, env, "/api/admin/contacts/export", { method: "POST", body: { email: "awa@example.com" }, cookie: c });
  assert.equal(r.status, 200);
  const data = r.body.export as Record<string, unknown[]>;
  assert.equal(data.applications.length, 1);
  assert.equal(data.businessInquiries.length, 1);
  assert.equal(data.applicationPhotos.length, 3);
  assert.equal(data.applicationHistory.length, 1);
  assert.ok(Array.isArray(data.notIncluded));
  const audit = env.DB.rows<{ action: string; target_id: string }>(`SELECT action, target_id FROM admin_audit WHERE action = 'contact.export'`);
  assert.equal(audit.length, 1);
  assert.match(audit[0]!.target_id, /^[0-9a-f]{16}$/);
  assert.equal((await call(exportContactApi as never, env, "/api/admin/contacts/export", { method: "POST", body: { email: "inconnu@example.org" }, cookie: c })).status, 404);
  assert.equal((await call(exportContactApi as never, env, "/api/admin/contacts/export", { method: "POST", body: { email: "pas-une-adresse" }, cookie: c })).status, 400);
  assert.equal((await call(exportContactApi as never, env, "/api/admin/contacts/export", { method: "POST", body: { email: "awa@example.com" } })).status, 401);
});

test("tableau de bord — chiffres réels, taux de transformation absent sans demande conclue, relances et conservation", async () => {
  const env = makeEnv();
  const c = await cookie();
  const empty = await call(metricsApi as never, env, "/api/admin/metrics", { cookie: c });
  assert.equal(empty.body.business.winRate, null);
  assert.equal(empty.body.talent.total, 0);

  const a = await newInquiry(env, "a@example.org");
  const b = await newInquiry(env, "b@example.org");
  await newInquiry(env, "c@example.org");
  await call(patchInquiry as never, env, `/api/admin/inquiries/${a}`, { method: "PATCH", body: { status: "WON", estimatedValue: 8000 }, cookie: c }, { id: a });
  await call(patchInquiry as never, env, `/api/admin/inquiries/${b}`, { method: "PATCH", body: { estimatedValue: 5000, nextAction: "Relancer", nextActionAt: "2026-01-01" }, cookie: c }, { id: b });
  const appId = await newApplication(env);
  await call(patchApplication as never, env, `/api/admin/applications/${appId}`, { method: "PATCH", body: { status: "REJECTED" }, cookie: c }, { id: appId });
  env.DB.db.prepare(`UPDATE applications SET updated_at = '2025-01-01T00:00:00.000Z'`).run();

  const m = (await call(metricsApi as never, env, "/api/admin/metrics", { cookie: c })).body;
  assert.equal(m.business.total, 3);
  assert.equal(m.business.winRate, 1);
  assert.equal(m.business.estimatedWonEur, 8000);
  assert.equal(m.business.estimatedOpenPipelineEur, 5000);
  assert.equal(m.business.followUpsDue.length, 1);
  assert.equal(m.talent.total, 1);
  assert.equal(m.talent.retentionReviewDue, 1);
  assert.ok(typeof m.generatedAt === "string");
  assert.equal((await call(metricsApi as never, env, "/api/admin/metrics")).status, 401);
});
