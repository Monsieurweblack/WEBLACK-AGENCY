import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateQualityGate } from "../validation/qualityGate.ts";
import type { RegisteredClaim } from "../validation/claimRegistry.ts";
import type { GeneratedArticle } from "../generation/types.ts";

function claim(status: RegisteredClaim["verificationStatus"], importance: RegisteredClaim["importance"] = "significant"): RegisteredClaim {
  return {
    claim: `Une affirmation ${status}`,
    publishedClaim: `Une affirmation ${status}`,
    claimLanguage: "fr",
    type: "general",
    importance,
    verificationStatus: status,
    verificationMethod: status === "VERIFIED" ? "EXACT" : "NONE",
    confidence: 90,
    sources: [],
    mismatches: [],
    reasoning: "",
  };
}

function article(): GeneratedArticle {
  return {
    lang: "fr",
    title: "Un titre parfaitement valable pour le Journal",
    slug: "un-titre-valable",
    excerpt: "Un excerpt de longueur raisonnable pour le contrôle.",
    category: "fashion",
    publishDate: "2026-09-15",
    author: "Monsieur W.",
    body: [{ _type: "block", _key: "k", style: "normal", children: [{ _type: "span", _key: "s", text: "Texte.", marks: [] }], markDefs: [] }],
    seo: { title: "Un titre SEO de longueur correcte pour le test", description: "Une meta description de longueur correcte, suffisamment longue pour passer le contrôle sans avertissement." },
    source: { name: "Test", url: "https://example.com" },
    editorialScore: 92,
    confidenceScore: 91,
  };
}

function gateWith(claims: RegisteredClaim[], eligibleForAutoPublish: boolean) {
  return evaluateQualityGate({
    article: article(),
    quality: { pass: true, errors: [], warnings: [] },
    antiCopy: { pass: true, copyRiskScore: 10, lexicalOverlapRatio: 0, longestSharedRunWords: 2, components: { lexical: 0, structural: 10 } },
    antiFabrication: { pass: true, unsupportedClaims: [], claims: [] },
    claimRegistry: { claims, pass: true, blockingClaims: [] },
    duplicate: { decision: "new_story", confidence: 90, reason: "", matchedArticleId: null, needsReview: false, signals: {} },
    eligibleForAutoPublish,
  });
}

test("an article with nothing unresolved publishes automatically when eligible", () => {
  const gate = gateWith([claim("VERIFIED"), claim("PARTIALLY_VERIFIED", "critical")], true);
  assert.equal(gate.finalDecision, "publish");
});

/**
 * Publication is the one step with no human between the engine and the
 * reader, and no way back once the page is live. Passing the gates is the
 * bar for a draft; going out unattended has to clear more.
 */
test("a single unverified claim blocks automatic publication and yields a draft instead", () => {
  const gate = gateWith([claim("VERIFIED"), claim("UNVERIFIED", "minor")], true);
  assert.equal(gate.finalDecision, "draft", "même une affirmation mineure non établie interdit de publier sans relecture");
  assert.ok(gate.reasons.some((r) => r.includes("Publication automatique refusée")), "the reason must say why it was held back");
});

test("a contradicted claim never publishes automatically", () => {
  assert.equal(gateWith([claim("CONTRADICTED", "minor")], true).finalDecision, "draft");
});

test("without eligibility the same article is a draft, silently — the extra bar only applies to publishing", () => {
  const gate = gateWith([claim("UNVERIFIED", "minor")], false);
  assert.equal(gate.finalDecision, "draft");
  assert.ok(!gate.reasons.some((r) => r.includes("Publication automatique refusée")));
});

test("a failing gate still rejects, publication eligibility notwithstanding", () => {
  const gate = evaluateQualityGate({
    article: article(),
    quality: { pass: false, errors: ["Titre en anglais"], warnings: [] },
    antiCopy: { pass: true, copyRiskScore: 10, lexicalOverlapRatio: 0, longestSharedRunWords: 2, components: { lexical: 0, structural: 10 } },
    antiFabrication: { pass: true, unsupportedClaims: [], claims: [] },
    claimRegistry: { claims: [claim("VERIFIED")], pass: true, blockingClaims: [] },
    duplicate: { decision: "new_story", confidence: 90, reason: "", matchedArticleId: null, needsReview: false, signals: {} },
    eligibleForAutoPublish: true,
  });
  assert.equal(gate.finalDecision, "reject");
});
