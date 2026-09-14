import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateQualityGate } from "../validation/qualityGate.ts";
import { JOURNAL_CATEGORIES } from "../generation/types.ts";
import type { GeneratedArticle } from "../generation/types.ts";
import type { QualityCheckResult } from "../validation/qualityCheck.ts";
import type { AntiCopyResult } from "../validation/antiCopy.ts";
import type { AntiFabricationResult } from "../validation/antiFabrication.ts";
import type { DuplicateDecision } from "../validation/dedupe.ts";
import type { ClaimRegistryResult } from "../validation/claimRegistry.ts";

function baseArticle(overrides: Partial<GeneratedArticle> = {}): GeneratedArticle {
  return {
    lang: "fr",
    title: "Un titre suffisamment long pour passer le contrôle",
    slug: "un-titre-suffisamment-long",
    excerpt: "Un excerpt correct.",
    category: "news",
    publishDate: "2026-01-01",
    author: "Signature Test",
    body: [
      {
        _type: "block",
        _key: "k1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Un paragraphe de contenu suffisant pour ne pas déclencher d'erreur de longueur minimale, avec plusieurs phrases distinctes pour dépasser le seuil de mots requis par le contrôle qualité existant.", marks: [] }],
        markDefs: [],
      },
    ],
    source: { name: "test", url: "https://example.com" },
    editorialScore: 85,
    confidenceScore: 85,
    ...overrides,
  };
}

const passingQuality: QualityCheckResult = { pass: true, errors: [], warnings: [] };
const passingCopy: AntiCopyResult = { copyRiskScore: 5, pass: true, lexicalOverlapRatio: 0, longestSharedRunWords: 0, components: { lexical: 0, structural: 0 } };
const passingFabrication: AntiFabricationResult = { pass: true, claims: [], unsupportedClaims: [] };
const passingClaimRegistry: ClaimRegistryResult = { claims: [], pass: true, blockingClaims: [] };
const distinctDuplicate: DuplicateDecision = { decision: "new_story", confidence: 80, reason: "", matchedArticleId: null, needsReview: false, signals: {} };

test("quality gate — all checks pass, not eligible for auto-publish => draft", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry,
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.finalDecision, "draft");
  assert.equal(gate.factCheck, "pass");
  assert.equal(gate.copyCheck, "pass");
  assert.equal(gate.duplicateCheck, "pass");
});

test("quality gate — all checks pass AND eligible for auto-publish => publish", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry,
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: true,
  });
  assert.equal(gate.finalDecision, "publish");
});

test("quality gate — unsupported claim (fact-check fail) always rejects, even if eligible for auto-publish", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: {
      pass: false,
      claims: [{ claim: "500 designers attended", supported: false, sourceEvidence: "", confidence: 90 }],
      unsupportedClaims: [{ claim: "500 designers attended", supported: false, sourceEvidence: "", confidence: 90 }],
    },
    claimRegistry: passingClaimRegistry,
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: true,
  });
  assert.equal(gate.finalDecision, "reject");
  assert.equal(gate.factCheck, "fail");
});

test("quality gate — copyRiskScore above threshold (copy check fail) rejects", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: passingQuality,
    antiCopy: { copyRiskScore: 75, pass: false, lexicalOverlapRatio: 0.3, longestSharedRunWords: 25, components: { lexical: 100, structural: 100 } },
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry,
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.finalDecision, "reject");
  assert.equal(gate.copyCheck, "fail");
});

test("quality gate — blocking duplicate decision rejects regardless of other checks", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry,
    duplicate: { decision: "duplicate_semantic", confidence: 90, reason: "same story", matchedArticleId: "abc", needsReview: false, signals: {} },
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.finalDecision, "reject");
  assert.equal(gate.duplicateCheck, "fail");
});

test("quality gate — a non-blocking duplicate decision (same_entity_different_event) never fails duplicateCheck", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry,
    duplicate: { decision: "same_entity_different_event", confidence: 60, reason: "shares a designer, different event", matchedArticleId: "abc", needsReview: false, signals: {} },
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.duplicateCheck, "pass");
  assert.equal(gate.finalDecision, "draft");
});

test("quality gate — schema check fails on missing required field (empty author)", () => {
  const gate = evaluateQualityGate({
    article: baseArticle({ author: "" }),
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry,
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.schemaCheck, "fail");
  assert.equal(gate.finalDecision, "reject");
});

test("quality gate — SEO issues never block publication (warnings only)", () => {
  const gate = evaluateQualityGate({
    article: baseArticle({ seo: { title: "x", description: "y" } }), // far too short — should warn, not fail
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry,
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.seoCheck, "pass");
  assert.ok(gate.reasons.some((r) => r.includes("SEO")));
});

test("quality gate — a FACT-CHECK FAIL (claim registry) rejects even when antiFabrication and editorial both pass", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: passingQuality,
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: {
      claims: [{ claim: "500 designers attended", type: "statistic", importance: "critical", verificationStatus: "UNVERIFIED", confidence: 95, sources: [], reasoning: "no evidence found" }],
      pass: false,
      blockingClaims: [{ claim: "500 designers attended", type: "statistic", importance: "critical", verificationStatus: "UNVERIFIED", confidence: 95, sources: [], reasoning: "no evidence found" }],
    },
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.factCheck, "fail");
  assert.equal(gate.finalDecision, "reject");
});

test("quality gate — a fully passing FACT-CHECK does not by itself make the article publishable (editorial failure still rejects)", () => {
  const gate = evaluateQualityGate({
    article: baseArticle(),
    quality: { pass: false, errors: ["Article trop court (10 mots, minimum 80)"], warnings: [] },
    antiCopy: passingCopy,
    antiFabrication: passingFabrication,
    claimRegistry: passingClaimRegistry, // every fact checks out...
    duplicate: distinctDuplicate,
    eligibleForAutoPublish: false,
  });
  assert.equal(gate.factCheck, "pass", "facts are genuinely fine");
  assert.equal(gate.editorialCheck, "fail");
  assert.equal(gate.finalDecision, "reject", "...but that alone never means 'ready to publish' — editorial quality is a separate gate");
});

test("category validation — every declared journal category is a plain string in the allowed list", () => {
  assert.ok(JOURNAL_CATEGORIES.includes("news"));
  assert.ok(JOURNAL_CATEGORIES.includes("fashion"));
  assert.equal((JOURNAL_CATEGORIES as readonly string[]).includes("not-a-real-category"), false);
});
