import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmVerdict, type ClaimVerdict } from "../validation/antiFabrication.ts";
import type { VerifiedFactSet } from "../generation/types.ts";

/**
 * These exercise the deterministic layer that confirms or overrules the
 * model, which is where the decision actually lives. Each case supplies the
 * verdict a model might return and asserts what the code does with it — so
 * what is under test is never "the model said so" but "the code checked it
 * against the Evidence Pack". Cases 6 to 8 are the ones that matter most:
 * there, the model says supported and the code says no.
 */
const pack: VerifiedFactSet = {
  sourceLanguage: "en",
  verified: [
    {
      fact: "The show attracted 496,000 visitors in September",
      category: "number",
      status: "VERIFIED",
      evidenceQuote: "the show attracted 496,000 visitors in September",
      evidenceTranslation: "",
    },
    {
      fact: "Prada opens the week at 2 p.m. on Sept. 22",
      category: "date",
      status: "VERIFIED",
      evidenceQuote: "Prada opens the week at 2 p.m. on Sept. 22",
      evidenceTranslation: "",
    },
    {
      fact: "She worked at Fendi, then at Dior",
      category: "general",
      status: "VERIFIED",
      evidenceQuote: "She worked at Fendi, then at Dior",
      evidenceTranslation: "",
    },
    {
      fact: "The Spring/Summer 2026 collection was shown in Lagos",
      category: "event",
      status: "VERIFIED",
      evidenceQuote: "The Spring/Summer 2026 collection was shown in Lagos",
      evidenceTranslation: "",
    },
  ],
  partiallyVerified: [],
  rejected: [],
};

/** Runs a sentence and a simulated model verdict through the deterministic confirmation. */
function verdictFor(sentence: string, modelVerdict: ClaimVerdict) {
  return confirmVerdict({ claim: sentence, verdict: modelVerdict, sourceEvidence: "(extrait)", confidence: 95 }, pack.verified);
}

test("1 — a supported reformulation is accepted", () => {
  const c = verdictFor("Le salon a attiré 496 000 visiteurs au mois de septembre.", "SUPPORTED_REFORMULATION");
  assert.equal(c.supported, true, "reformuler un fait vérifié est le travail normal d'un rédacteur");
});

test("2 — a supported translation is accepted", () => {
  const c = verdictFor("Prada ouvre la semaine le 22 septembre.", "SUPPORTED_TRANSLATION");
  assert.equal(c.supported, true);
});

test("3 — a normalized figure is accepted (496,000 written 496 000)", () => {
  const c = verdictFor("Le salon a réuni 496 000 visiteurs.", "NORMALIZED_FACT");
  assert.equal(c.supported, true);
});

test("4 — a normalized time and season are accepted (2 p.m. written 14 heures, SS26)", () => {
  assert.equal((verdictFor("Le défilé commence à 14 heures.", "NORMALIZED_FACT")).supported, true);
  assert.equal((verdictFor("La collection SS26 a été présentée à Lagos.", "NORMALIZED_FACT")).supported, true);
});

test("5 — a true fabrication stays blocked", () => {
  const c = verdictFor("La maison a ouvert quarante boutiques cette année.", "TRUE_FABRICATION");
  assert.equal(c.supported, false);
});

test("6 — an invented figure is blocked even when the model calls it a reformulation", () => {
  const c = verdictFor("Le salon a attiré 497 000 visiteurs.", "SUPPORTED_REFORMULATION");
  assert.equal(c.supported, false, "497 000 n'est pas 496 000 — l'auto-déclaration du modèle ne vaut pas preuve");
  assert.equal(c.verdict, "TRUE_FABRICATION");
  assert.equal(c.downgradedFrom, "SUPPORTED_REFORMULATION");
});

test("7 — an invented causality is blocked even when the model calls it supported", () => {
  const c = verdictFor("Son passage chez Fendi l'a conduite chez Dior.", "SUPPORTED_REFORMULATION");
  assert.equal(c.supported, false, "la succession est sourcée, le lien de cause ne l'est pas");
  assert.equal(c.verdict, "UNSUPPORTED_DEDUCTION");
});

test("8 — commentary may not smuggle in a figure under the name of analysis", () => {
  const c = verdictFor("Cette édition, avec ses 800 000 entrées, marque un tournant.", "LEGITIMATE_ANALYSIS");
  assert.equal(c.supported, false);
});

test("genuine analysis carrying no facts is accepted", () => {
  const c = verdictFor("Ce déplacement du calendrier en dit long sur les priorités du secteur.", "LEGITIMATE_ANALYSIS");
  assert.equal(c.supported, true, "une mise en perspective sans fait nouveau est légitime");
});
