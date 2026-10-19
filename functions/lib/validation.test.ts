import { test } from "node:test";
import assert from "node:assert/strict";
import { validateApplication, computeAge, parseDecimal } from "./validation.ts";
import type { ApplicationPayload } from "./applicationTypes.ts";

function basePayload(overrides: Partial<ApplicationPayload> = {}): ApplicationPayload {
  return {
    firstName: "Awa",
    lastName: "Diallo",
    birthDate: "2000-01-01",
    city: "Dakar",
    country: "Sénégal",
    email: "awa@example.com",
    phone: "+221 77 000 00 00",
    experienceLevel: "beginner",
    photoIds: { portrait: ["p1"], profile: ["p2"], full_length: ["p3"], extra: [] },
    accuracyConfirmed: true,
    privacyNoticeAccepted: true,
    privacyNoticeVersion: "2026-10-19",
    ...overrides,
  };
}

test("un dossier complet et cohérent ne produit aucune erreur", () => {
  assert.deepEqual(validateApplication(basePayload(), false), []);
});

test("les champs de profil obligatoires sont vérifiés indépendamment", () => {
  const errors = validateApplication(basePayload({ firstName: "", email: "pas-un-email" }), false);
  const fields = errors.map((e) => e.field);
  assert.ok(fields.includes("firstName"));
  assert.ok(fields.includes("email"));
});

test("un mineur est refusé quand minorsAllowed est faux — jamais une base légale inventée", () => {
  const errors = validateApplication(basePayload({ birthDate: "2015-01-01" }), false);
  assert.ok(errors.some((e) => e.field === "birthDate" && e.reason === "minors_not_accepted"));
});

test("un mineur passe quand minorsAllowed est vrai (le contrôle représentant légal reste à la charge de submit.ts)", () => {
  const errors = validateApplication(basePayload({ birthDate: "2015-01-01" }), true);
  assert.ok(!errors.some((e) => e.field === "birthDate"));
});

test("aucune mensuration n'est obligatoire, et aucune n'est éliminatoire si plausible", () => {
  const errors = validateApplication(basePayload({ heightCm: 150, hipsCm: 130 }), false);
  assert.deepEqual(errors, []);
});

test("une mensuration implausible (négative, ou hors échelle humaine) est rejetée pour sa forme, pas pour son seuil physique", () => {
  const errors = validateApplication(basePayload({ heightCm: -5 }), false);
  assert.ok(errors.some((e) => e.field === "heightCm"));
});

test("les trois photos obligatoires doivent toutes être présentes", () => {
  const errors = validateApplication(basePayload({ photoIds: { portrait: ["p1"], profile: [], full_length: ["p3"], extra: [] } }), false);
  assert.ok(errors.some((e) => e.field === "photo.profile"));
});

test("plus de 3 photos complémentaires est refusé", () => {
  const errors = validateApplication(
    basePayload({ photoIds: { portrait: ["p1"], profile: ["p2"], full_length: ["p3"], extra: ["e1", "e2", "e3", "e4"] } }),
    false,
  );
  assert.ok(errors.some((e) => e.field === "photo.extra"));
});

test("la case d'exactitude et la notice de confidentialité sont obligatoires", () => {
  const errors = validateApplication(basePayload({ accuracyConfirmed: false, privacyNoticeAccepted: false }), false);
  assert.ok(errors.some((e) => e.field === "accuracyConfirmed"));
  assert.ok(errors.some((e) => e.field === "privacyNoticeAccepted"));
});

test("parseDecimal accepte la virgule et le point, jamais les deux à la fois", () => {
  assert.equal(parseDecimal("172,5"), 172.5);
  assert.equal(parseDecimal("172.5"), 172.5);
  assert.equal(parseDecimal("abc"), undefined);
  assert.equal(parseDecimal(""), undefined);
});

test("computeAge calcule l'âge exact selon que l'anniversaire est déjà passé cette année", () => {
  assert.equal(computeAge("2000-06-15", new Date("2026-06-14")), 25);
  assert.equal(computeAge("2000-06-15", new Date("2026-06-15")), 26);
  assert.equal(computeAge("2000-06-15", new Date("2026-06-16")), 26);
});

test("computeAge renvoie undefined sur une date mal formée, jamais un âge inventé", () => {
  assert.equal(computeAge("pas-une-date"), undefined);
  assert.equal(computeAge("2026-13-01"), undefined); // mois hors échelle
  assert.equal(computeAge("2026-02-30"), undefined); // 30 février n'existe pas (Date.UTC le ferait "rouler" vers mars sans ce contrôle)
});
