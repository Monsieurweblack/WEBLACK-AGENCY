/**
 * Demande commerciale : fonction publique (business-inquiry.ts) et
 * administration (admin/inquiries*), contre une base SQLite en mémoire
 * portant les migrations du dépôt. Aucun appel réel : Resend est simulé.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as submit, onRequestGet as probe } from "../api/business-inquiry.ts";
import { onRequestGet as list } from "../api/admin/inquiries.ts";
import { onRequestGet as detail, onRequestPatch as patch, onRequestPost as renotify, onRequestDelete as remove } from "../api/admin/inquiries/[id].ts";
import { createSessionCookie } from "./adminSession.ts";
import { parseInquiry } from "./inquiryValidation.ts";
import { inquiryReference, INQUIRY_RETENTION_DAYS } from "./inquiryOptions.ts";
import { purgeExpiredInquiries } from "./inquiryStore.ts";
import { FakeKV, network, SqliteD1 } from "./testDoubles.ts";

const SECRET = "test-session-secret-0123456789abcdef";
let ip = 0;

function makeEnv(extra: Record<string, unknown> = {}) {
  return {
    DB: new SqliteD1(),
    PHOTOS: new FakeKV(),
    NEWSLETTER_API_KEY: "test-key",
    RESEND_FROM: "WEBLACK <talents@weblack.test>",
    BUSINESS_INQUIRY_NOTIFY_EMAIL: "equipe@example.com",
    ADMIN_SESSION_SECRET: SECRET,
    APP_ENV: "preview",
    ...extra,
  };
}
type Env = ReturnType<typeof makeEnv>;

const valid = (over: Record<string, unknown> = {}) => ({
  submissionId: "66666666-6666-4666-8666-666666666666",
  lang: "fr",
  division: "creative",
  service: "campaign",
  fullName: "Test Exemple",
  email: "test@example.org",
  organisation: "Maison Exemple",
  country: "FR",
  description: "Campagne de lancement d'une collection capsule, photo et vidéo, au printemps.",
  timeline: "1_3_months",
  budget: "to_define",
  channel: "instagram",
  entryPoint: "creative",
  utmCampaign: "launch_spring",
  website: "",
  ...over,
});

function req(url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  ip += 1;
  const headers = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": `10.9.${Math.floor(ip / 250)}.${ip % 250}` });
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(url, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function post(env: Env, body: unknown, host = "weblack.test") {
  const response = await submit({ request: req(`https://${host}/api/business-inquiry`, { method: "POST", body }), env: env as never, params: {} });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function cookie() {
  return (await createSessionCookie(SECRET)).split(";")[0]!;
}

const rows = (env: Env) => env.DB.rows<Record<string, unknown>>(`SELECT * FROM business_inquiries`);

beforeEach(() => network.reset());

test("brief — demande valide : enregistrée, référence renvoyée, équipe notifiée sans donnée dans la réponse", async () => {
  const env = makeEnv();
  const { status, body } = await post(env, valid());
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(String(body.reference), /^WBL-[0-9A-F]{8}$/);
  const [row] = rows(env);
  assert.equal(row!.status, "NEW");
  assert.equal(row!.division, "creative");
  assert.equal(row!.channel, "instagram");
  assert.equal(row!.entry_point, "creative");
  assert.equal(row!.reference, body.reference);
  assert.equal(row!.notify_status, "sent");
  assert.equal(network.sent.length, 1);
  assert.equal(network.sent[0]!.to, "equipe@example.com");
  assert.equal(network.sent[0]!.idempotencyKey, `inquiry-notify-${row!.id}`);
  assert.equal(JSON.stringify(body).includes("test@example.org"), false);
});

test("brief — double envoi du même formulaire : une seule demande, même référence, un seul e-mail", async () => {
  const env = makeEnv();
  const first = await post(env, valid());
  const second = await post(env, valid());
  assert.equal(second.status, 200);
  assert.equal(second.body.reference, first.body.reference);
  assert.equal(second.body.duplicate, true);
  assert.equal(rows(env).length, 1);
  assert.equal(network.sent.length, 1);
});

test("brief — champs facultatifs absents acceptés ; budget jamais éliminatoire", async () => {
  const env = makeEnv();
  const { status } = await post(env, valid({ organisation: "", timeline: "", budget: "", submissionId: undefined, channel: undefined, entryPoint: undefined }));
  assert.equal(status, 200);
  const [row] = rows(env);
  assert.equal(row!.budget, null);
  assert.equal(row!.organisation, null);
  assert.equal(row!.channel, "direct");
});

test("brief — validation : champs requis, prestation hors division, pays inconnu, description trop courte", async () => {
  const env = makeEnv();
  const { status, body } = await post(env, valid({ fullName: "", email: "pas-une-adresse", service: "strategy", country: "ZZ", description: "Court" }));
  assert.equal(status, 422);
  const fields = (body.errors as { field: string; reason: string }[]).map((e) => `${e.field}:${e.reason}`).sort();
  assert.deepEqual(fields, ["country:invalid", "description:too_short", "email:invalid", "fullName:required", "service:invalid"]);
  assert.equal(rows(env).length, 0);
});

test("brief — origine nettoyée : jamais de texte libre ni d'adresse dans le canal", () => {
  const parsed = parseInquiry(valid({ channel: "jean@example.org", entryPoint: "<script>", utmMedium: "Social Paid!" }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.channel, "direct");
  assert.equal(parsed.value.entryPoint, "other");
  assert.equal(parsed.value.utmMedium, null);
});

test("brief — leurre rempli : succès apparent, rien n'est écrit ni envoyé", async () => {
  const env = makeEnv();
  const { status, body } = await post(env, valid({ website: "https://spam.example" }));
  assert.equal(status, 200);
  assert.equal(body.reference, "WBL-00000000");
  assert.equal(rows(env).length, 0);
  assert.equal(network.sent.length, 0);
});

test("brief — garde-fou : liaisons de production hors weblack.fr refusées, weblack.fr accepté", async () => {
  const env = makeEnv({ APP_ENV: "production" });
  const blocked = await post(env, valid(), "weblack.pages.dev");
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.reason, "not_configured");
  assert.equal(rows(env).length, 0);
  const probeBlocked = await probe({ request: req("https://abc.weblack.pages.dev/api/business-inquiry"), env: env as never, params: {} });
  assert.equal(((await probeBlocked.json()) as { configured: boolean }).configured, false);
  const allowed = await post(env, valid(), "weblack.fr");
  assert.equal(allowed.status, 200);
});

test("brief — e-mail non configuré : la demande reste reçue, l'état est consigné", async () => {
  const env = makeEnv({ NEWSLETTER_API_KEY: undefined });
  const { status } = await post(env, valid());
  assert.equal(status, 200);
  assert.equal(rows(env)[0]!.notify_status, "not_configured");
  assert.equal(network.sent.length, 0);
});

test("brief — refus du fournisseur : demande reçue, échec consigné sans donnée personnelle", async () => {
  network.resend = "invalid_key";
  const env = makeEnv();
  const { status } = await post(env, valid());
  assert.equal(status, 200);
  const [row] = rows(env);
  assert.equal(row!.notify_status, "failed");
  assert.match(String(row!.notify_error), /^http_\d{3}:/);
});

test("brief — limite de débit : 429 au-delà de 8 envois par heure depuis la même adresse", async () => {
  const env = makeEnv();
  const send = () =>
    submit({
      request: new Request("https://weblack.test/api/business-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.200.0.1" },
        body: JSON.stringify(valid({ submissionId: crypto.randomUUID() })),
      }),
      env: env as never,
      params: {},
    });
  for (let i = 0; i < 8; i++) assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 429);
});

test("brief — corps trop volumineux et JSON invalide refusés", async () => {
  const env = makeEnv();
  const big = await post(env, valid({ description: "x".repeat(20_000) }));
  assert.equal(big.status, 413);
  const bad = await submit({
    request: new Request("https://weblack.test/api/business-inquiry", { method: "POST", body: "{", headers: { "CF-Connecting-IP": "10.201.0.1" } }),
    env: env as never,
    params: {},
  });
  assert.equal(bad.status, 400);
});

test("admin — sans session : 401 sur liste, détail et modification", async () => {
  const env = makeEnv();
  await post(env, valid());
  const id = String(rows(env)[0]!.id);
  assert.equal((await list({ request: req("https://weblack.test/api/admin/inquiries"), env: env as never, params: {} })).status, 401);
  assert.equal((await detail({ request: req(`https://weblack.test/api/admin/inquiries/${id}`), env: env as never, params: { id } })).status, 401);
  assert.equal(
    (await patch({ request: req(`https://weblack.test/api/admin/inquiries/${id}`, { method: "PATCH", body: { status: "WON" } }), env: env as never, params: { id } })).status,
    401,
  );
});

test("admin — liste sans e-mail ni description ; statut et note journalisés ; suppression", async () => {
  const env = makeEnv();
  await post(env, valid());
  const c = await cookie();
  const listed = (await (await list({ request: req("https://weblack.test/api/admin/inquiries", { cookie: c }), env: env as never, params: {} })).json()) as {
    inquiries: Record<string, unknown>[];
  };
  assert.equal(listed.inquiries.length, 1);
  assert.equal("email" in listed.inquiries[0]!, false);
  assert.equal("description" in listed.inquiries[0]!, false);
  const id = String(listed.inquiries[0]!.id);

  const bad = await patch({ request: req(`https://weblack.test/api/admin/inquiries/${id}`, { method: "PATCH", body: { status: "SIGNED" }, cookie: c }), env: env as never, params: { id } });
  assert.equal(bad.status, 400);

  for (const status of ["TO_QUALIFY", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION", "WON"]) {
    const r = await patch({ request: req(`https://weblack.test/api/admin/inquiries/${id}`, { method: "PATCH", body: { status }, cookie: c }), env: env as never, params: { id } });
    assert.equal(r.status, 200);
  }
  await patch({ request: req(`https://weblack.test/api/admin/inquiries/${id}`, { method: "PATCH", body: { note: "Appel prévu jeudi." }, cookie: c }), env: env as never, params: { id } });
  const shown = (await (await detail({ request: req(`https://weblack.test/api/admin/inquiries/${id}`, { cookie: c }), env: env as never, params: { id } })).json()) as {
    inquiry: Record<string, unknown>;
    events: Record<string, unknown>[];
  };
  assert.equal(shown.inquiry.status, "WON");
  assert.equal(shown.inquiry.email, "test@example.org");
  assert.equal(shown.events.length, 6);

  const again = (await (await renotify({ request: req(`https://weblack.test/api/admin/inquiries/${id}`, { method: "POST", cookie: c }), env: env as never, params: { id } })).json()) as {
    outcome: string;
  };
  assert.equal(again.outcome, "skipped");

  const deleted = await remove({ request: req(`https://weblack.test/api/admin/inquiries/${id}`, { method: "DELETE", cookie: c }), env: env as never, params: { id } });
  assert.equal(deleted.status, 200);
  assert.equal(rows(env).length, 0);
  assert.equal(env.DB.rows(`SELECT * FROM business_inquiry_events`).length, 0);
});

test("conservation — une demande sans activité depuis plus de trois ans est supprimée", async () => {
  const env = makeEnv();
  await post(env, valid());
  await post(env, valid({ submissionId: "77777777-7777-4777-8777-777777777777" }));
  const old = new Date(Date.now() - (INQUIRY_RETENTION_DAYS + 1) * 86_400_000).toISOString();
  env.DB.db.prepare(`UPDATE business_inquiries SET updated_at = ? WHERE submission_id = ?`).run(old, "66666666-6666-4666-8666-666666666666");
  assert.equal(await purgeExpiredInquiries(env.DB as never), 1);
  assert.equal(rows(env).length, 1);
});

test("référence — dérivée de l'identifiant, format stable", () => {
  assert.equal(inquiryReference("3f9a21c0-1111-4111-8111-111111111111"), "WBL-3F9A21C0");
});
