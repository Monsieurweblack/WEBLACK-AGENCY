import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAge, isHttpUrl, normalizePhone, parseApplication, parseDecimal, type ValidationError } from "./validation.ts";
import { TEST_PHOTO_IDS, validPayload } from "./testFixtures.ts";

const TODAY = new Date("2026-10-20T12:00:00Z");
const P1 = TEST_PHOTO_IDS.portrait;
const P2 = TEST_PHOTO_IDS.profile;
const P3 = TEST_PHOTO_IDS.fullLength;

function errorsOf(payload: Record<string, unknown>, minorsAllowed = false): ValidationError[] {
  const result = parseApplication(payload, minorsAllowed, TODAY);
  return result.ok ? [] : result.errors;
}

function hasError(errors: ValidationError[], field: string, reason?: string): boolean {
  return errors.some((e) => e.field === field && (reason === undefined || e.reason === reason));
}

// 1 — candidature adulte valide
test("une candidature adulte complète est acceptée et normalisée", () => {
  const result = parseApplication(validPayload(), false, TODAY);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.phone, "+221770000000", "le téléphone est normalisé en E.164");
  assert.equal(result.value.isMinor, false);
  assert.deepEqual(result.value.languages, ["fr", "wo"]);
  assert.equal(result.value.photoIds.length, 3);
});

// 2 — refus d'une personne mineure
test("une personne mineure est refusée côté serveur quand minorsAllowed est faux", () => {
  assert.ok(hasError(errorsOf(validPayload({ birthDate: "2010-01-01" })), "birthDate", "minors_not_accepted"));
});

test("l'âge est calculé au jour près : la veille des 18 ans reste refusée", () => {
  assert.ok(hasError(errorsOf(validPayload({ birthDate: "2008-10-21" })), "birthDate", "minors_not_accepted"));
  assert.ok(!hasError(errorsOf(validPayload({ birthDate: "2008-10-20" })), "birthDate"));
});

test("si le parcours mineur était ouvert, le représentant légal deviendrait obligatoire", () => {
  const errors = errorsOf(validPayload({ birthDate: "2010-01-01" }), true);
  assert.ok(hasError(errors, "legalGuardianName", "required"));
  assert.ok(hasError(errors, "legalGuardianEmail", "required"));
});

// 3 — date de naissance invalide
test("une date de naissance invalide est refusée, jamais « roulée » vers une autre date", () => {
  assert.ok(hasError(errorsOf(validPayload({ birthDate: "2001-02-30" })), "birthDate", "format"));
  assert.ok(hasError(errorsOf(validPayload({ birthDate: "15/01/2000" })), "birthDate", "format"));
  assert.ok(hasError(errorsOf(validPayload({ birthDate: "1900-01-01" })), "birthDate", "implausible"));
});

// 4 — champ obligatoire manquant
test("chaque champ obligatoire manquant est signalé individuellement", () => {
  const errors = errorsOf(validPayload({ firstName: "  ", email: undefined, mobility: undefined, experienceDuration: "" }));
  assert.ok(hasError(errors, "firstName", "required"));
  assert.ok(hasError(errors, "email", "required"));
  assert.ok(hasError(errors, "mobility", "required"));
  assert.ok(hasError(errors, "experienceDuration", "required"));
});

test("au moins une langue ou une précision « autre » est exigée", () => {
  assert.ok(hasError(errorsOf(validPayload({ languages: [] })), "languages", "required"));
  assert.ok(!hasError(errorsOf(validPayload({ languages: [], languagesOther: "Peul" })), "languages"));
});

// 5 — valeur de liste invalide
test("une valeur hors liste (modifiée dans le navigateur) est refusée", () => {
  const errors = errorsOf(
    validPayload({ category: "superstar", country: "ZZ", mobility: "mars", eyeColor: "violet", desiredProjects: ["runway", "hacked"], languages: ["xx"] }),
  );
  for (const field of ["category", "country", "mobility", "eyeColor", "desiredProjects", "languages"]) {
    assert.ok(hasError(errors, field, "invalid"), field);
  }
});

test("une sélection multiple ne peut pas contenir de doublon", () => {
  assert.ok(hasError(errorsOf(validPayload({ desiredProjects: ["runway", "runway"] })), "desiredProjects", "duplicate"));
});

// 6 — réponse conditionnelle manquante
test("« Autre » exige sa précision ; une autre catégorie l'ignore", () => {
  assert.ok(hasError(errorsOf(validPayload({ category: "other" })), "categoryOther", "required"));
  const ok = parseApplication(validPayload({ category: "other", categoryOther: "Danseuse" }), false, TODAY);
  assert.ok(ok.ok && ok.value.categoryOther === "Danseuse");
  const ignored = parseApplication(validPayload({ category: "runway", categoryOther: "ignoré" }), false, TODAY);
  assert.ok(ignored.ok && ignored.value.categoryOther === null);
});

test("une pointure sans système de taille est refusée", () => {
  assert.ok(hasError(errorsOf(validPayload({ shoeSize: 42 })), "shoeSystem", "required"));
  assert.ok(!hasError(errorsOf(validPayload({ shoeSize: 42.5, shoeSystem: "EU" })), "shoeSize"));
});

// 7 — URL invalide
test("les liens portfolio sont facultatifs mais doivent être des URL http(s)", () => {
  assert.ok(!hasError(errorsOf(validPayload({ portfolioLinks: [] })), "portfolioLinks"));
  assert.ok(!hasError(errorsOf(validPayload({ portfolioLinks: ["https://models.example.com/awa"] })), "portfolioLinks"));
  assert.ok(hasError(errorsOf(validPayload({ portfolioLinks: ["javascript:alert(1)"] })), "portfolioLinks", "format"));
  assert.ok(hasError(errorsOf(validPayload({ portfolioLinks: ["pas une url"] })), "portfolioLinks", "format"));
  assert.ok(hasError(errorsOf(validPayload({ instagram: "https://evil.example.com/x" })), "instagram", "format"));
});

// 8 — texte trop long
test("un texte au-delà de sa limite est refusé", () => {
  assert.ok(hasError(errorsOf(validPayload({ motivation: "x".repeat(1501) })), "motivation", "too_long"));
  assert.ok(hasError(errorsOf(validPayload({ firstName: "x".repeat(81) })), "firstName", "too_long"));
});

// 9 — valeur mal typée
test("une valeur au mauvais type est refusée, jamais convertie silencieusement", () => {
  const errors = errorsOf(
    validPayload({ heightCm: "178", firstName: 42, languages: "fr", photoIds: "x", accuracyConfirmed: "true" }),
  );
  assert.ok(hasError(errors, "heightCm", "type"));
  assert.ok(hasError(errors, "firstName", "type"));
  assert.ok(hasError(errors, "languages", "type"));
  assert.ok(hasError(errors, "photoIds", "type"));
  assert.ok(hasError(errors, "accuracyConfirmed", "required"));
  assert.deepEqual(errorsOf(null as unknown as Record<string, unknown>), [{ field: "body", reason: "type" }]);
});

test("une mensuration hors plage humaine est refusée pour sa forme, pas comme seuil de sélection", () => {
  assert.ok(hasError(errorsOf(validPayload({ heightCm: 400 })), "heightCm", "out_of_range"));
  assert.ok(!hasError(errorsOf(validPayload({ heightCm: 150 })), "heightCm"));
  assert.ok(!hasError(errorsOf(validPayload({ heightCm: undefined })), "heightCm"), "aucune mensuration n'est obligatoire");
});

test("les photos : trois rôles requis, identifiants au bon format, sans doublon, 3 complémentaires max", () => {
  assert.ok(hasError(errorsOf(validPayload({ photoIds: { portrait: [P1], profile: [], full_length: [P3] } })), "photo.profile", "required"));
  assert.ok(hasError(errorsOf(validPayload({ photoIds: { portrait: ["../etc"], profile: [P2], full_length: [P3] } })), "photo.portrait", "required"));
  assert.ok(hasError(errorsOf(validPayload({ photoIds: { portrait: [P1], profile: [P1], full_length: [P3] } })), "photoIds", "duplicate"));
  const extra = [1, 2, 3, 4].map((n) => `4444444${n}-4444-4444-8444-444444444444`);
  assert.ok(hasError(errorsOf(validPayload({ photoIds: { portrait: [P1], profile: [P2], full_length: [P3], extra } })), "photo.extra", "too_many"));
});

test("le téléphone doit être au format international", () => {
  assert.ok(hasError(errorsOf(validPayload({ phone: "06 12 34 56 78" })), "phone", "format"));
  assert.ok(!hasError(errorsOf(validPayload({ phone: "+33 6 12 34 56 78" })), "phone"));
  assert.equal(normalizePhone("+33 (6) 12-34.56 78"), "+33612345678");
});

test("la langue de soumission doit être fr ou en", () => {
  assert.ok(hasError(errorsOf(validPayload({ lang: "de" })), "lang", "invalid"));
});

// 14 — absence de fuite dans les erreurs
test("une erreur ne contient jamais la valeur reçue, seulement le champ et une raison", () => {
  const errors = errorsOf(validPayload({ email: "secret-person@example.com-invalid", phone: "0612" }));
  const serialized = JSON.stringify(errors);
  assert.ok(!serialized.includes("secret-person"));
  assert.ok(!serialized.includes("0612"));
  for (const error of errors) assert.deepEqual(Object.keys(error).sort(), ["field", "reason"]);
});

test("utilitaires : décimales, âge, URL", () => {
  assert.equal(parseDecimal("172,5"), 172.5);
  assert.equal(parseDecimal("abc"), undefined);
  assert.equal(computeAge("2000-06-15", new Date("2026-06-14T00:00:00Z")), 25);
  assert.equal(computeAge("2000-06-15", new Date("2026-06-15T00:00:00Z")), 26);
  assert.equal(computeAge("2026-02-30"), undefined);
  assert.equal(isHttpUrl("https://example.com"), true);
  assert.equal(isHttpUrl("ftp://example.com"), false);
});
