import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { freshnessBand, freshnessPoints, isEligibleForDisplay } from "../now/freshness.ts";
import { scoreSignal, sourceRankPoints } from "../now/relevance.ts";
import { evaluateNowGate } from "../now/qualityGate.ts";
import { NOW_POLICY } from "../now/types.ts";
import { signalIdentity, saveSignal, currentSignals, findSignal } from "../now/store.ts";
import { checkNowDuplicate } from "../now/dedupe.ts";
import { toNowSignalDocument, nowSignalSlug } from "../sanity/now.ts";
import type { AntiFabricationResult } from "../validation/antiFabrication.ts";
import type { NowSignal } from "../now/types.ts";
import type { SourceArticle } from "../sources/types.ts";

// Test isolation (§18 resistance tests must never touch the real local
// store — same convention as EDITORIAL_TEST_DB in tests/setup.ts).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testStorePath = path.join(__dirname, `.test-now-${process.pid}-${Date.now()}.jsonl`);
process.env.EDITORIAL_TEST_NOW_STORE = testStorePath;
process.on("exit", () => {
  try {
    fs.unlinkSync(testStorePath);
  } catch {
    // best-effort cleanup
  }
});

const passingFabrication: AntiFabricationResult = {
  pass: true,
  claims: [],
  unsupportedClaims: [],
  byVerdict: { SUPPORTED_REFORMULATION: 1, SUPPORTED_TRANSLATION: 0, NORMALIZED_FACT: 0, LEGITIMATE_ANALYSIS: 0, UNSUPPORTED_DEDUCTION: 0, TRUE_FABRICATION: 0 },
};
const failingFabrication: AntiFabricationResult = {
  pass: false,
  claims: [],
  unsupportedClaims: [{ claim: "un chiffre inventé", supported: false, sourceEvidence: "", confidence: 40, verdict: "TRUE_FABRICATION" }],
  byVerdict: { SUPPORTED_REFORMULATION: 0, SUPPORTED_TRANSLATION: 0, NORMALIZED_FACT: 0, LEGITIMATE_ANALYSIS: 0, UNSUPPORTED_DEDUCTION: 0, TRUE_FABRICATION: 1 },
};

function baseGateInputs() {
  return {
    title: "Une maison annonce une collaboration",
    summary: "Une maison de mode annonce une collaboration avec un studio de design, selon un communiqué officiel.",
    territory: "FASHION_LUXURY" as const,
    date: "",
    dateRequired: false,
    sourceUrl: "https://dezeen.com/2026/09/exemple",
    compositeRelevance: 80,
    freshnessBand: "FRESH" as const,
    duplicate: { isDuplicate: false, reason: "" },
    antiFabrication: passingFabrication,
  };
}

// ---------------------------------------------------------------- freshness

test("freshnessBand — un fait d'il y a 2h est FRESH", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const band = freshnessBand({ sourcePublishedAt: "2026-09-19T10:00:00Z", discoveredAt: "2026-09-19T12:00:00Z" }, now);
  assert.equal(band, "FRESH");
});

test("freshnessBand — un fait d'il y a 5 jours est CURRENT", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const band = freshnessBand({ sourcePublishedAt: "2026-09-14T12:00:00Z", discoveredAt: "2026-09-14T12:00:00Z" }, now);
  assert.equal(band, "CURRENT");
});

test("freshnessBand — un fait d'il y a 20 jours est HISTORICAL", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const band = freshnessBand({ sourcePublishedAt: "2026-08-30T12:00:00Z", discoveredAt: "2026-08-30T12:00:00Z" }, now);
  assert.equal(band, "HISTORICAL");
});

test("freshnessBand — un fait d'il y a 40 jours est EXPIRED — résistance : information trop ancienne", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const band = freshnessBand({ sourcePublishedAt: "2026-08-10T12:00:00Z", discoveredAt: "2026-08-10T12:00:00Z" }, now);
  assert.equal(band, "EXPIRED");
});

test("freshnessBand — date illisible => EXPIRED, jamais FRESH par défaut — résistance : contenu sans date exploitable", () => {
  const band = freshnessBand({ sourcePublishedAt: "n'importe quoi", discoveredAt: "aussi n'importe quoi" });
  assert.equal(band, "EXPIRED");
});

test("freshnessBand — sourcePublishedAt prime toujours sur discoveredAt", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  // Republié tardivement (discoveredAt récent) mais réellement ancien (sourcePublishedAt) : ne doit pas paraître frais.
  const band = freshnessBand({ sourcePublishedAt: "2026-08-01T00:00:00Z", discoveredAt: "2026-09-19T11:00:00Z" }, now);
  assert.equal(band, "EXPIRED");
});

test("freshnessBand — horloge de flux légèrement en avance => FRESH, jamais une erreur bloquante — résistance : contenu contradictoire (dates)", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const band = freshnessBand({ discoveredAt: "2026-09-19T12:05:00Z" }, now);
  assert.equal(band, "FRESH");
});

test("isEligibleForDisplay — seuls FRESH et CURRENT sont montrables", () => {
  assert.equal(isEligibleForDisplay("FRESH"), true);
  assert.equal(isEligibleForDisplay("CURRENT"), true);
  assert.equal(isEligibleForDisplay("HISTORICAL"), false);
  assert.equal(isEligibleForDisplay("EXPIRED"), false);
});

test("freshnessPoints — décroissant strictement avec l'âge, jamais négatif", () => {
  assert.ok(freshnessPoints("FRESH") > freshnessPoints("CURRENT"));
  assert.ok(freshnessPoints("CURRENT") > freshnessPoints("HISTORICAL"));
  assert.ok(freshnessPoints("HISTORICAL") > freshnessPoints("EXPIRED"));
  assert.equal(freshnessPoints("EXPIRED"), 0);
});

// ----------------------------------------------------------------- pertinence

test("sourceRankPoints — une source officielle vaut strictement plus qu'une source secondaire", () => {
  assert.ok(sourceRankPoints("OFFICIAL") > sourceRankPoints("MEDIA"));
  assert.ok(sourceRankPoints("MEDIA") > sourceRankPoints("SECONDARY"));
});

test("scoreSignal — chaque facteur est individuellement traçable (§9)", () => {
  const breakdown = scoreSignal({ analysis: { relevance: 80, reliability: 70, importance: 60 }, sourceRank: "MEDIA", freshnessBand: "FRESH" });
  assert.equal(breakdown.editorialRelevance, 80);
  assert.equal(breakdown.sourceRankPoints, sourceRankPoints("MEDIA"));
  assert.equal(breakdown.freshnessPoints, 100);
  assert.equal(breakdown.signalStrengthPoints, 65); // (70+60)/2
  assert.ok(breakdown.composite >= 0 && breakdown.composite <= 100);
});

test("scoreSignal — une source officielle et fraîche score strictement plus haut qu'une source secondaire et historique, à pertinence éditoriale égale", () => {
  const strong = scoreSignal({ analysis: { relevance: 70, reliability: 70, importance: 70 }, sourceRank: "OFFICIAL", freshnessBand: "FRESH" });
  const weak = scoreSignal({ analysis: { relevance: 70, reliability: 70, importance: 70 }, sourceRank: "SECONDARY", freshnessBand: "HISTORICAL" });
  assert.ok(strong.composite > weak.composite);
});

test("scoreSignal — jamais hors bornes 0-100, même avec des entrées extrêmes", () => {
  const breakdown = scoreSignal({ analysis: { relevance: 999, reliability: -50, importance: 0 }, sourceRank: "OFFICIAL", freshnessBand: "FRESH" });
  assert.ok(breakdown.composite >= 0 && breakdown.composite <= 100);
  assert.ok(breakdown.editorialRelevance <= 100);
  assert.ok(breakdown.signalStrengthPoints >= 0);
});

// -------------------------------------------------------------- Quality Gate

test("evaluateNowGate — tout passe => published", () => {
  const gate = evaluateNowGate(baseGateInputs());
  assert.equal(gate.decision, "published");
  assert.equal(gate.reasons.length, 0);
});

test("evaluateNowGate — résistance : URL morte / source indisponible => rejected (bloquant)", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), sourceUrl: "pas-une-url" });
  assert.equal(gate.sourceValid, false);
  assert.equal(gate.decision, "rejected");
});

test("evaluateNowGate — résistance : contenu sans territoire WEBLACK => rejected (bloquant, jamais un score bas qui se faufile)", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), territory: NOW_POLICY.excludedTerritory });
  assert.equal(gate.identityValid, false);
  assert.equal(gate.decision, "rejected");
});

test("evaluateNowGate — résistance : doublon détecté => rejected (bloquant)", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), duplicate: { isDuplicate: true, reason: "déjà en stock" } });
  assert.equal(gate.noDuplicate, false);
  assert.equal(gate.decision, "rejected");
});

test("evaluateNowGate — résistance : contenu sans preuve / fabrication détectée => rejected (bloquant, jamais rattrapé par un bon score)", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), compositeRelevance: 99, antiFabrication: failingFabrication });
  assert.equal(gate.noFabrication, false);
  assert.equal(gate.decision, "rejected");
});

test("evaluateNowGate — pertinence sous le seuil => review, pas rejected (décision humaine possible, §12)", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), compositeRelevance: NOW_POLICY.minCompositeRelevance - 1 });
  assert.equal(gate.relevanceValid, false);
  assert.equal(gate.decision, "review");
});

test("evaluateNowGate — résistance : information trop ancienne (EXPIRED) => review, jamais publié tel quel", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), freshnessBand: "EXPIRED" });
  assert.equal(gate.freshnessValid, false);
  assert.equal(gate.decision, "review");
});

test("evaluateNowGate — date exigée et absente => review", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), dateRequired: true, date: "" });
  assert.equal(gate.dateValid, false);
  assert.equal(gate.decision, "review");
});

test("evaluateNowGate — date exigée et présente, au bon format => dateValid", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), dateRequired: true, date: "2026-10-01" });
  assert.equal(gate.dateValid, true);
});

test("evaluateNowGate — résistance : résumé vide => review (contenu invalide)", () => {
  const gate = evaluateNowGate({ ...baseGateInputs(), summary: "" });
  assert.equal(gate.contentValid, false);
  assert.equal(gate.decision, "review");
});

test("evaluateNowGate — jamais publish sans que les 8 conditions soient TOUTES vraies", () => {
  const gate = evaluateNowGate(baseGateInputs());
  if (gate.decision === "published") {
    assert.equal(gate.sourceValid, true);
    assert.equal(gate.identityValid, true);
    assert.equal(gate.dateValid, true);
    assert.equal(gate.contentValid, true);
    assert.equal(gate.relevanceValid, true);
    assert.equal(gate.freshnessValid, true);
    assert.equal(gate.noDuplicate, true);
    assert.equal(gate.noFabrication, true);
  }
});

// -------------------------------------------------------------------- stock

function fixtureSignal(overrides: Partial<NowSignal> = {}): NowSignal {
  return {
    id: signalIdentity({ title: "Un signal de test", sourceUrl: "https://example.com/a" }),
    origin: "editorial-signal",
    title: "Un signal de test",
    titleEn: "A test signal",
    territory: "ART_CULTURE",
    summary: "Résumé de test.",
    summaryEn: "Test summary.",
    relevanceReason: "Test.",
    date: "",
    source: { name: "Example", rank: "MEDIA", url: "https://example.com/a", publisher: "Example" },
    discoveredAt: new Date().toISOString(),
    language: "en",
    relevance: scoreSignal({ analysis: { relevance: 80, reliability: 70, importance: 70 }, sourceRank: "MEDIA", freshnessBand: "FRESH" }),
    status: "published",
    statusReason: "",
    ...overrides,
  };
}

test("signalIdentity — déterministe : mêmes titre+URL produisent le même id", () => {
  const a = signalIdentity({ title: "Étude Fendi × Studio X", sourceUrl: "https://example.com/x" });
  const b = signalIdentity({ title: "Étude Fendi × Studio X", sourceUrl: "https://example.com/x" });
  assert.equal(a, b);
});

test("signalIdentity — insensible aux accents/casse, comme eventIdentity — résistance : contenu multilingue", () => {
  const a = signalIdentity({ title: "Édition spéciale", sourceUrl: "https://example.com/x" });
  const b = signalIdentity({ title: "edition speciale", sourceUrl: "https://example.com/x" });
  assert.equal(a, b);
});

test("store — append-only : le dernier état d'un id fait foi", () => {
  const s = fixtureSignal();
  saveSignal(s);
  saveSignal({ ...s, status: "rejected", statusReason: "réévalué" });
  const current = findSignal(s.id);
  assert.equal(current?.status, "rejected");
  assert.equal(currentSignals().filter((x) => x.id === s.id).length, 1);
});

// ------------------------------------------------------------------- dédoublonnage

function fixtureArticle(overrides: Partial<SourceArticle> = {}): SourceArticle {
  return {
    sourceName: "Example Feed",
    sourceUrl: "https://example.com/feed",
    url: "https://example.com/article-unique",
    canonicalUrl: "https://example.com/article-unique",
    title: "Un titre totalement inédit pour ce test",
    publishedAt: new Date().toISOString(),
    author: undefined,
    excerpt: "Extrait.",
    text: "Texte complet.",
    imageUrl: undefined,
    hash: "test-hash-unique",
    ...overrides,
  };
}

test("checkNowDuplicate — résistance : aucun doublon pour un titre/URL inédits", () => {
  const decision = checkNowDuplicate(fixtureArticle());
  assert.equal(decision.isDuplicate, false);
});

test("checkNowDuplicate — résistance : même URL qu'un signal déjà en stock => doublon", () => {
  const s = fixtureSignal({ source: { name: "Example", rank: "MEDIA", url: "https://example.com/deja-connu", publisher: "Example" } });
  saveSignal(s);
  const decision = checkNowDuplicate(fixtureArticle({ url: "https://example.com/deja-connu", canonicalUrl: "https://example.com/deja-connu" }));
  assert.equal(decision.isDuplicate, true);
});

test("checkNowDuplicate — résistance : titre quasi identique à un signal en stock => doublon même sur une URL différente", () => {
  const s = fixtureSignal({ title: "Une maison annonce sa collection printemps-été", source: { name: "Example", rank: "MEDIA", url: "https://example.com/premiere-annonce", publisher: "Example" } });
  saveSignal(s);
  const decision = checkNowDuplicate(fixtureArticle({ title: "Une maison annonce sa collection printemps été", url: "https://example.com/reprise-ailleurs", canonicalUrl: "https://example.com/reprise-ailleurs" }));
  assert.equal(decision.isDuplicate, true);
});

// --------------------------------------------------------------------- Sanity

test("toNowSignalDocument — résistance : image indisponible => champ simplement absent, jamais une valeur inventée", () => {
  const doc = toNowSignalDocument(fixtureSignal());
  assert.equal("imageUrl" in doc, false);
});

test("toNowSignalDocument — une image réelle est reprise telle quelle (jamais réhébergée : juste l'URL)", () => {
  const doc = toNowSignalDocument(fixtureSignal({ imageUrl: "https://example.com/photo.jpg" }));
  assert.equal(doc.imageUrl, "https://example.com/photo.jpg");
});

test("toNowSignalDocument — aucune date écrite quand la source n'en donne pas", () => {
  const doc = toNowSignalDocument(fixtureSignal({ date: "" }));
  assert.equal("eventDate" in doc, false);
});

test("nowSignalSlug — déterministe et lisible", () => {
  const slug = nowSignalSlug(fixtureSignal({ title: "Une Maison Annonce", discoveredAt: "2026-09-19T10:00:00Z" }));
  assert.equal(slug, "une-maison-annonce-2026-09-19");
});
