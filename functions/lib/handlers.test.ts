/**
 * Tests des fonctions Pages réelles (submit.ts, upload.ts) et de la file
 * d'e-mails, contre une base SQLite en mémoire portant les migrations du
 * dépôt et un KV en mémoire — aucun appel à la production, aucune
 * candidature réelle créée. Seul `fetch` (Sanity, Resend) est simulé.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as submit, onRequestGet as probe } from "../api/talent-application/submit.ts";
import { onRequestPost as upload } from "../api/talent-application/upload.ts";
import { deliverOutbox, MAX_EMAIL_ATTEMPTS } from "./talentOutbox.ts";
import { TEST_PHOTO_IDS, validPayload } from "./testFixtures.ts";
import { FakeKV, JPEG, network, PNG, seedPhotos, SqliteD1 } from "./testDoubles.ts";

let ipCounter = 0;

function makeEnv(extra: Record<string, unknown> = {}) {
  return {
    DB: new SqliteD1(),
    PHOTOS: new FakeKV(),
    SANITY_PROJECT_ID: "test",
    SANITY_DATASET: "test",
    NEWSLETTER_API_KEY: "test-key",
    RESEND_FROM: "WEBLACK TALENTS <talents@weblack.test>",
    ...extra,
  };
}
type Env = ReturnType<typeof makeEnv>;

function submitRequest(body: unknown): Request {
  ipCounter += 1;
  return new Request("https://weblack.test/api/talent-application/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
    body: JSON.stringify(body),
  });
}

async function callSubmit(env: Env, body: unknown) {
  const response = await submit({ request: submitRequest(body), env: env as never, params: {} });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const ALL_IDS = [TEST_PHOTO_IDS.portrait, TEST_PHOTO_IDS.profile, TEST_PHOTO_IDS.fullLength];
const SUBMISSION = "55555555-5555-4555-8555-555555555555";

const applications = (env: Env) => env.DB.rows<Record<string, unknown>>(`SELECT * FROM applications`);
const outbox = (env: Env) => env.DB.rows<Record<string, unknown>>(`SELECT * FROM email_outbox ORDER BY kind`);
const ttlOf = (env: Env, id: string) => env.PHOTOS.store.get(`photo:${id}`)?.ttl;

beforeEach(() => network.reset());

// --- Formulaire et validation -------------------------------------------------------

test("submit — candidature valide en français : dossier, photos et e-mails écrits en une transaction, photos permanentes", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload({ submissionId: SUBMISSION }));

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(String(body.reference), /^[0-9A-F]{8}$/);
  assert.equal(env.DB.batchCount, 1, "une seule transaction");

  const [row] = applications(env);
  assert.equal(String(row!.id).slice(0, 8).toUpperCase(), body.reference);
  assert.equal(row!.talent_category, "runway");
  assert.equal(row!.experience_duration, "none");
  assert.equal(row!.languages, JSON.stringify(["fr", "wo"]));
  assert.equal(row!.phone, "+221770000000");
  assert.equal(row!.submission_lang, "fr");
  assert.equal(row!.submission_id, SUBMISSION);
  assert.equal(row!.is_minor, 0);

  const photos = env.DB.rows<{ id: string; application_id: string; role: string }>(`SELECT * FROM application_photos ORDER BY role`);
  assert.equal(photos.length, 3);
  assert.ok(photos.every((p) => p.application_id === row!.id), "chaque photo rattachée au bon dossier");
  for (const id of ALL_IDS) assert.equal(ttlOf(env, id), undefined, "plus de TTL après promotion");
});

test("submit — candidature valide en anglais : langue conservée dans le dossier", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status } = await callSubmit(env, validPayload({ lang: "en" }));
  assert.equal(status, 200);
  assert.equal(applications(env)[0]!.submission_lang, "en");
});

test("submit — champs obligatoires absents, e-mail invalide, données malformées : 422 sans écriture", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const missing = await callSubmit(env, validPayload({ firstName: undefined, email: "pas-une-adresse", heightCm: "très grand", languages: "fr" }));
  assert.equal(missing.status, 422);
  const fields = (missing.body.errors as { field: string }[]).map((e) => e.field);
  for (const field of ["firstName", "email", "heightCm", "languages"]) assert.ok(fields.includes(field), field);
  assert.equal(applications(env).length, 0);
  assert.equal(network.resendCalls, 0);
});

test("submit — mineur refusé côté serveur même si le navigateur est contourné", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload({ birthDate: "2012-05-05" }));
  assert.equal(status, 422);
  assert.deepEqual(body.errors, [{ field: "birthDate", reason: "minors_not_accepted" }]);
  assert.equal(applications(env).length, 0);
  assert.equal(ttlOf(env, TEST_PHOTO_IDS.portrait), 7200, "photos non promues");
});

test("submit — contournement du navigateur : valeur hors liste, champ de représentant légal forcé, mineur déguisé", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const forged = await callSubmit(env, validPayload({ category: "vip", mobility: "partout", desiredProjects: ["<script>"] }));
  assert.equal(forged.status, 422);
  // Un client qui joint des champs « représentant légal » ne rouvre pas le parcours mineur.
  const minor = await callSubmit(env, validPayload({ birthDate: "2010-01-01", legalGuardianName: "X", legalGuardianEmail: "x@example.com", legalGuardianPhone: "+33600000000" }));
  assert.equal(minor.status, 422);
  assert.equal(applications(env).length, 0);
});

test("submit — campagne fermée dans Sanity : refus 403, aucune écriture", async () => {
  network.campaign = { applicationsOpen: false, minorsAllowed: false };
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 403);
  assert.equal(body.reason, "closed");
  assert.equal(applications(env).length, 0);
});

test("submit — Sanity indisponible : 503 « indisponible » (pas « fermé »), jamais ouvert par défaut", async () => {
  network.sanityDown = true;
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 503);
  assert.equal(body.reason, "unavailable");
  assert.equal(applications(env).length, 0);

  const state = (await (await probe({ request: new Request("https://weblack.test/x"), env: env as never, params: {} })).json()) as Record<string, unknown>;
  assert.deepEqual([state.available, state.open, state.minorsAllowed], [false, false, false]);
});

test("submit — Sanity ouvre la campagne mais minorsAllowed absent : les mineurs restent refusés", async () => {
  network.campaign = { applicationsOpen: true };
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { body } = await callSubmit(env, validPayload({ birthDate: "2011-01-01" }));
  assert.deepEqual(body.errors, [{ field: "birthDate", reason: "minors_not_accepted" }]);
});

test("submit — photo inexistante ou expirée : refus, aucune écriture", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, [TEST_PHOTO_IDS.portrait, TEST_PHOTO_IDS.profile]); // full_length absente
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 422);
  assert.equal(body.reason, "photo_missing_or_expired");
  assert.equal(applications(env).length, 0);
});

test("submit — une photo déjà rattachée à un autre dossier est refusée (409) et reste intacte", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  await callSubmit(env, validPayload({ submissionId: SUBMISSION }));
  const other = await callSubmit(env, validPayload({ submissionId: "66666666-6666-4666-8666-666666666666", email: "autre@example.com" }));
  assert.equal(other.status, 409);
  assert.equal(other.body.reason, "photo_already_used");
  assert.equal(applications(env).length, 1);
  for (const id of ALL_IDS) assert.equal(ttlOf(env, id), undefined, "les photos du premier dossier restent permanentes");
});

test("submit — double requête du même formulaire : un seul dossier, même référence, un seul jeu d'e-mails", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const first = await callSubmit(env, validPayload({ submissionId: SUBMISSION }));
  const second = await callSubmit(env, validPayload({ submissionId: SUBMISSION }));
  assert.equal(second.status, 200);
  assert.equal(second.body.reference, first.body.reference);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.confirmationEmail, "sent");
  assert.equal(applications(env).length, 1);
  assert.equal(network.sent.length, 2, "confirmation + notification, une seule fois");
  for (const id of ALL_IDS) assert.equal(ttlOf(env, id), undefined);
});

test("submit — double clic simultané : la course est tranchée par l'index unique, aucune photo rétrogradée", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const [a, b] = await Promise.all([callSubmit(env, validPayload({ submissionId: SUBMISSION })), callSubmit(env, validPayload({ submissionId: SUBMISSION }))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.reference, b.body.reference);
  assert.equal(applications(env).length, 1);
  for (const id of ALL_IDS) assert.equal(ttlOf(env, id), undefined, "photos du dossier gagnant toujours permanentes");
});

test("submit — échec D1 : erreur explicite, jamais de succès, photos rétrogradées, aucun e-mail", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  env.DB.failNextBatch = true;
  const { status, body } = await callSubmit(env, validPayload({ submissionId: SUBMISSION }));
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "storage");
  assert.equal(body.reference, undefined);
  for (const id of ALL_IDS) assert.equal(ttlOf(env, id), 7200, "photo redevenue temporaire");
  assert.equal(outbox(env).length, 0);
  assert.equal(network.resendCalls, 0, "aucun e-mail après un échec d'enregistrement");
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

test("submit — limitation de débit : au-delà de 10 envois par heure et par IP, 429", async () => {
  const env = makeEnv();
  const request = () =>
    submit({
      request: new Request("https://weblack.test/x", { method: "POST", body: "{}", headers: { "CF-Connecting-IP": "10.9.9.9" } }),
      env: env as never,
      params: {},
    });
  for (let i = 0; i < 10; i++) await request();
  assert.equal((await request()).status, 429);
});

// --- E-mails ------------------------------------------------------------------------

test("e-mail — confirmation envoyée après l'enregistrement, en français, avec la bonne référence ; notification séparée", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { body } = await callSubmit(env, validPayload());
  assert.equal(body.confirmationEmail, "sent");

  const candidate = network.sent.find((m) => m.to === "awa@example.com")!;
  assert.match(candidate.subject, /^Candidature reçue — WEBLACK TALENTS \(réf\. [0-9A-F]{8}\)$/);
  assert.ok(candidate.subject.includes(String(body.reference)));
  assert.ok(candidate.text.includes(String(body.reference)) && candidate.html.includes(String(body.reference)));
  assert.ok(candidate.text.startsWith("Bonjour Awa,"));
  assert.equal(candidate.replyTo, "weblackconsulting@gmail.com");
  assert.ok(!/AFRICA/.test(candidate.html + candidate.text + candidate.subject), "marque WEBLACK uniquement");
  assert.ok(!/garanti(e|s)? (votre|une) sélection|vous serez sélectionné/i.test(candidate.text), "aucune promesse de sélection");

  const notification = network.sent.find((m) => m.to === "equipe@example.com")!;
  assert.ok(notification.subject.includes(String(body.reference)));
  assert.ok(!notification.text.includes("Diallo") && !notification.text.includes("awa@example.com"), "notification sans données personnelles");

  const rows = outbox(env);
  assert.deepEqual(rows.map((r) => [r.kind, r.status, r.attempts]), [["admin_notification", "sent", 1], ["candidate_confirmation", "sent", 1]]);
  assert.ok(rows.every((r) => network.sent.some((m) => m.idempotencyKey === r.id)), "clé d'idempotence = id de la ligne");
});

test("e-mail — candidature en anglais : confirmation en anglais", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { body } = await callSubmit(env, validPayload({ lang: "en" }));
  const candidate = network.sent.find((m) => m.to === "awa@example.com")!;
  assert.equal(candidate.subject, `Application received — WEBLACK TALENTS (ref. ${body.reference})`);
  assert.ok(candidate.text.startsWith("Hello Awa,"));
  assert.ok(candidate.html.includes('lang="en"'));
});

test("e-mail — prénom échappé dans le HTML", async () => {
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  await callSubmit(env, validPayload({ firstName: "<b>Awa</b>" }));
  const candidate = network.sent.find((m) => m.to === "awa@example.com")!;
  assert.ok(!candidate.html.includes("<b>Awa</b>") && candidate.html.includes("&lt;b&gt;Awa&lt;/b&gt;"));
});

test("e-mail — panne du fournisseur : candidature conservée, échec tracé sans donnée personnelle, aucun faux succès", async () => {
  network.resend = "server_error";
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload({ submissionId: SUBMISSION }));
  assert.equal(status, 200, "la candidature est enregistrée");
  assert.equal(body.confirmationEmail, "pending", "le navigateur n'annonce pas un e-mail parti");
  assert.equal(applications(env).length, 1);
  const rows = outbox(env);
  assert.ok(rows.every((r) => r.status === "failed" && r.last_error === "http_500:internal_server_error"));
  assert.ok(!JSON.stringify(rows).includes("awa@example.com"));
});

test("e-mail — relance après panne : envoyé une seule fois, même clé d'idempotence, aucun dossier dupliqué", async () => {
  network.resend = "network";
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  await callSubmit(env, validPayload({ submissionId: SUBMISSION }));
  const failed = outbox(env).find((r) => r.kind === "candidate_confirmation")!;
  assert.equal(failed.last_error, "network");

  network.resend = "ok";
  // Relance automatique trop tôt : le délai entre tentatives est respecté.
  const early = await deliverOutbox(env as never, { sanityNotifyEmail: "equipe@example.com" });
  assert.ok(Object.values(early.outcomes).every((o) => o === "skipped"));
  // Relance manuelle (administration).
  await deliverOutbox(env as never, { force: true, sanityNotifyEmail: "equipe@example.com" });
  await deliverOutbox(env as never, { force: true, sanityNotifyEmail: "equipe@example.com" });

  const confirmations = network.sent.filter((m) => m.to === "awa@example.com");
  assert.equal(confirmations.length, 1, "une seule confirmation acceptée");
  assert.equal(confirmations[0]!.idempotencyKey, failed.id);
  assert.equal(applications(env).length, 1);
  assert.ok(outbox(env).every((r) => r.status === "sent" && r.attempts === 2));
});

test("e-mail — nombre de tentatives plafonné", async () => {
  network.resend = "server_error";
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  await callSubmit(env, validPayload());
  for (let i = 0; i < MAX_EMAIL_ATTEMPTS + 2; i++) await deliverOutbox(env as never, { force: true, sanityNotifyEmail: "equipe@example.com" });
  assert.ok(outbox(env).every((r) => r.attempts === MAX_EMAIL_ATTEMPTS && r.status === "failed"));
});

test("e-mail — clé API absente : rien n'est tenté, ligne en attente sans tentative consommée, envoi dès configuration", async () => {
  const env = makeEnv({ NEWSLETTER_API_KEY: undefined });
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 200);
  assert.equal(body.confirmationEmail, "pending");
  assert.equal(network.resendCalls, 0);
  assert.ok(outbox(env).every((r) => r.status === "pending" && r.attempts === 0 && r.last_error === "not_configured"));

  (env as Record<string, unknown>).NEWSLETTER_API_KEY = "test-key";
  await deliverOutbox(env as never, { sanityNotifyEmail: "equipe@example.com" });
  assert.ok(outbox(env).every((r) => r.status === "sent"));
});

test("e-mail — clé API refusée par le fournisseur : échec consigné (http_401), candidature intacte", async () => {
  network.resend = "invalid_key";
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { status, body } = await callSubmit(env, validPayload());
  assert.equal(status, 200);
  assert.equal(body.confirmationEmail, "pending");
  assert.ok(outbox(env).every((r) => r.last_error === "http_401:validation_error"));
});

test("e-mail — aucun destinataire interne configuré : la confirmation candidat part quand même", async () => {
  network.campaign = { applicationsOpen: true, minorsAllowed: false };
  const env = makeEnv();
  await seedPhotos(env.PHOTOS, ALL_IDS);
  const { body } = await callSubmit(env, validPayload());
  assert.equal(body.confirmationEmail, "sent");
  const notification = outbox(env).find((r) => r.kind === "admin_notification")!;
  assert.equal(notification.status, "pending");
  assert.equal(notification.last_error, "no_recipient");
});

// --- Upload -------------------------------------------------------------------------

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
      headers: { "CF-Connecting-IP": `10.2.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
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
  assert.equal((await callUpload(new File(["<svg onload=alert(1)>"], "photo.svg", { type: "image/svg+xml" }))).body.reason, "invalid_type");
});

test("upload — fichier vide, trop volumineux ou rôle inconnu refusés", async () => {
  assert.equal((await callUpload(new File([], "photo.jpg", { type: "image/jpeg" }))).body.reason, "invalid_size");
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set(JPEG);
  assert.equal((await callUpload(new File([big], "photo.jpg", { type: "image/jpeg" }))).body.reason, "invalid_size");
  assert.equal((await callUpload(new File([JPEG], "photo.jpg", { type: "image/jpeg" }), "admin")).body.reason, "invalid_role");
});
