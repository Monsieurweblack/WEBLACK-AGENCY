import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmVerdict } from "../validation/antiFabrication.ts";
import { containsRelationMarker } from "../validation/equivalences.ts";
import { neutralizeCausality } from "../generation/neutralizeCausality.ts";
import type { GeneratedArticle, VerifiedFactSet } from "../generation/types.ts";

/**
 * The Evidence Pack states two facts side by side and one genuine causal
 * fact. Assembling the first two is the writer's job; asserting a link
 * between them is not.
 */
const pack: VerifiedFactSet = {
  sourceLanguage: "en",
  verified: [
    { fact: "Chiuri worked at Fendi", category: "general", status: "VERIFIED", evidenceQuote: "Chiuri worked at Fendi", evidenceTranslation: "Chiuri a travaillé chez Fendi" },
    { fact: "Chiuri joined Dior later", category: "general", status: "VERIFIED", evidenceQuote: "Chiuri joined Dior later", evidenceTranslation: "Chiuri a rejoint Dior plus tard" },
    {
      fact: "The appointment was driven by the accessories strategy",
      category: "general",
      status: "VERIFIED",
      evidenceQuote: "the appointment was driven by the accessories strategy",
      evidenceTranslation: "la nomination s'explique par la stratégie accessoires",
    },
  ],
  partiallyVerified: [],
  rejected: [],
};

const judge = (sentence: string) => confirmVerdict({ claim: sentence, verdict: "SUPPORTED_REFORMULATION", sourceEvidence: "(extrait)", confidence: 95 }, pack.verified);

test("causalité supportée → PASS", () => {
  const c = judge("La nomination s'explique par la stratégie accessoires de la maison.");
  assert.equal(c.supported, true, "la preuve énonce elle-même le lien de cause");
});

test("causalité non supportée → REJECT", () => {
  const c = judge("Son passage chez Fendi l'a conduite chez Dior.");
  assert.equal(c.supported, false);
  assert.equal(c.verdict, "UNSUPPORTED_DEDUCTION");
});

test("simple chronologie → PASS", () => {
  const c = judge("Chiuri a travaillé chez Fendi avant de rejoindre Dior.");
  assert.equal(c.supported, true, "juxtaposer deux faits vérifiés est autorisé — c'est le travail du rédacteur");
});

test("conséquence inventée → REJECT", () => {
  assert.equal(judge("Ce recrutement a entraîné une hausse des ventes.").supported, false);
  assert.equal(judge("Chiuri a rejoint Dior. Par conséquent, la maison a changé de direction.").supported, false);
});

test("motivation inventée → REJECT", () => {
  assert.equal(judge("Elle a quitté Fendi afin de rejoindre Dior.").supported, false);
  assert.equal(judge("La maison l'a recrutée dans le but de relancer les accessoires.").supported, false);
});

test("comparaison inventée → REJECT", () => {
  assert.equal(judge("Son travail chez Dior a marqué davantage que son passage chez Fendi.").supported, false);
});

test("le modèle ne peut pas déclarer lui-même qu'une causalité est supportée", () => {
  // Le modèle affirme que c'est une reformulation supportée ; le contrôle programmatique tranche.
  const c = confirmVerdict(
    { claim: "Son expérience chez Fendi l'a conduite chez Dior.", verdict: "SUPPORTED_REFORMULATION", sourceEvidence: "Chiuri worked at Fendi", confidence: 99 },
    pack.verified,
  );
  assert.equal(c.supported, false);
  assert.equal(c.downgradedFrom, "SUPPORTED_REFORMULATION");
});

// ---------------------------------------------------------------------------
// Neutralisation automatique
// ---------------------------------------------------------------------------

function articleSaying(...sentences: string[]): GeneratedArticle {
  return {
    lang: "fr",
    title: "Un titre de test suffisamment long",
    slug: "test",
    excerpt: "Un excerpt de test de longueur raisonnable.",
    category: "fashion",
    publishDate: "2026-09-15",
    author: "Monsieur W.",
    body: sentences.map((text, i) => ({
      _type: "block" as const,
      _key: `k${i}`,
      style: "normal" as const,
      children: [{ _type: "span" as const, _key: `s${i}`, text, marks: [] }],
      markDefs: [] as [],
    })),
    source: { name: "Test", url: "https://example.com" },
    editorialScore: 80,
    confidenceScore: 80,
  };
}

const textOf = (a: GeneratedArticle) =>
  a.body.filter((b) => b._type === "block").map((b) => (b._type === "block" ? b.children.map((c) => c.text).join("") : "")).join("\n");

test("un connecteur de conséquence est retiré, les faits restent", () => {
  const { article, rewrites } = neutralizeCausality(
    articleSaying("Par conséquent, la ville se prépare à recevoir les visiteurs."),
  );
  const out = textOf(article);
  assert.equal(rewrites.length, 1);
  assert.ok(!containsRelationMarker(out), `causalité encore présente : ${out}`);
  assert.match(out, /^La ville se prépare/, "le fait subsiste, seule l'assertion de conséquence disparaît");
});

test("une subordonnée causale n'est pas découpée — la découper laisserait un fragment sans verbe", () => {
  const original = "La marque a ouvert un atelier, ce qui a entraîné une hausse de la production.";
  const { article, rewrites, irreducible } = neutralizeCausality(articleSaying(original));
  assert.equal(rewrites.length, 0, "« une hausse de la production. » ne serait pas une phrase");
  assert.equal(irreducible.length, 1, "elle part au fact-check, qui la rejettera");
  assert.equal(textOf(article), original, "mieux vaut un rejet qu'un français cassé publié");
});

test("un connecteur au milieu de la phrase est retiré sans abîmer le reste", () => {
  const { article, rewrites } = neutralizeCausality(
    articleSaying("Le calendrier est chargé, par conséquent, les maisons avancent leurs présentations."),
  );
  const out = textOf(article);
  assert.equal(rewrites.length, 1);
  assert.ok(!containsRelationMarker(out), `causalité encore présente : ${out}`);
  assert.match(out, /chargé les maisons avancent|chargé, les maisons avancent/);
});

test("une causalité portée par le verbe n'est jamais réécrite — elle est signalée pour rejet", () => {
  const { article, rewrites, irreducible } = neutralizeCausality(
    articleSaying("Son expérience chez Fendi l'a conduite chez Dior."),
  );
  assert.equal(rewrites.length, 0, "réécrire cette phrase demanderait de reformuler la prose, pas de retirer un connecteur");
  assert.equal(irreducible.length, 1, "elle doit être signalée, pas maquillée");
  assert.equal(textOf(article), "Son expérience chez Fendi l'a conduite chez Dior.", "le texte reste intact");
});

test("une phrase sans causalité n'est pas touchée", () => {
  const original = "Chiuri a travaillé chez Fendi avant de rejoindre Dior.";
  const { article, rewrites } = neutralizeCausality(articleSaying(original));
  assert.equal(rewrites.length, 0);
  assert.equal(textOf(article), original);
});

test("« ainsi que » n'est pas confondu avec une conséquence", () => {
  assert.equal(containsRelationMarker("La maison présente des sacs ainsi que des souliers."), false);
  assert.equal(containsRelationMarker("Ainsi, la maison a changé de direction."), true);
});
