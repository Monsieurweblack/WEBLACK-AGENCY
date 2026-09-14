import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverEvidence, assertsUnsupportedRelation } from "../validation/evidenceRecovery.ts";
import { extractComparableTokens, containsRelationMarker } from "../validation/equivalences.ts";
import { trimToLimit, SEO_TITLE_MAX, SEO_DESCRIPTION_MAX } from "../seo/seo.ts";
import type { VerifiedFact, VerifiedFactSet } from "../generation/types.ts";

function fact(overrides: Partial<VerifiedFact> = {}): VerifiedFact {
  return {
    fact: "Chiuri kicked off her career at Fendi in 1989",
    category: "date",
    status: "VERIFIED",
    evidenceQuote: "as the designer kicked off her career there in 1989, helping to boost the brand's accessories",
    evidenceTranslation: "la créatrice a débuté sa carrière chez Fendi en 1989",
    ...overrides,
  };
}

function pack(facts: VerifiedFact[], partially: VerifiedFact[] = []): VerifiedFactSet {
  return { sourceLanguage: "en", verified: facts, partiallyVerified: partially, rejected: [] };
}

// ---------------------------------------------------------------------------
// A — false "sources: 0" rejections
// ---------------------------------------------------------------------------

test("A — the campaign's own case: 'Chiuri a débuté chez Fendi en 1989' recovers the VERIFIED fact's proof", () => {
  const recovered = recoverEvidence("Chiuri a débuté chez Fendi en 1989.", "date", pack([fact()]));
  assert.ok(recovered, "a faithful restatement of a verified fact must recover its proof");
  assert.equal(recovered!.fact.status, "VERIFIED");
  assert.match(recovered!.fact.evidenceQuote, /kicked off her career there in 1989/, "the original proof is preserved, not replaced");
  assert.ok(recovered!.matchedTokens.includes("1989"));
});

test("A — the recovered status is the original fact's own, never an upgrade", () => {
  const recovered = recoverEvidence("Chiuri a débuté chez Fendi en 1989.", "date", pack([], [fact({ status: "PARTIALLY_VERIFIED" })]));
  assert.equal(recovered?.fact.status, "PARTIALLY_VERIFIED", "a partially verified fact can only ever yield a partially verified claim");
});

test("A — a claim introducing a figure the fact does not contain recovers nothing", () => {
  assert.equal(recoverEvidence("Chiuri a débuté chez Fendi en 1990.", "date", pack([fact()])), undefined, "1990 is not 1989");
  assert.equal(
    recoverEvidence("Chiuri a débuté chez Fendi en 1989 et y a passé 12 ans.", "date", pack([fact()])),
    undefined,
    "the extra '12 ans' is not in the fact, so the claim is not a restatement of it",
  );
});

test("A — lexical proximity alone never recovers: an unrelated claim sharing a year gets nothing", () => {
  const unrelated = recoverEvidence("Le chiffre d'affaires du groupe atteignait 1989 millions d'euros.", "statistic", pack([fact()]));
  assert.equal(unrelated, undefined, "same number, different subject — recovery must refuse");
});

test("A — a direct quote never recovers, whatever it resembles", () => {
  const quotePack = pack([fact({ category: "quote", fact: '"Dull is the ultimate risk"', evidenceQuote: "Dull is the ultimate risk" })]);
  assert.equal(recoverEvidence("« L'ennui est le risque ultime », dit-elle.", "quote", quotePack), undefined);
});

test("A — no Evidence Pack means no recovery at all", () => {
  assert.equal(recoverEvidence("Chiuri a débuté chez Fendi en 1989.", "date", undefined), undefined);
});

// Real Phase 5 case: the extraction step left evidenceTranslation empty, so
// a French claim had to be matched against English-only evidence.
test("A — a French claim recovers from English-only evidence when the figure and the subject stems line up", () => {
  const english = pack(
    [],
    [
      fact({
        fact: "UNESCO valued the African fashion industry at about 31 billion US dollars in 2023, near 1.2 percent of the global market",
        category: "number",
        status: "PARTIALLY_VERIFIED",
        evidenceQuote: "UNESCO valued the African fashion industry at about 31 billion US dollars",
        evidenceTranslation: "",
      }),
      fact({
        fact: "The continent still imports about 23 billion dollars of clothing and fabric a year",
        category: "number",
        status: "PARTIALLY_VERIFIED",
        evidenceQuote: "The continent still imports about 23 billion dollars of clothing and fabric a year",
        evidenceTranslation: "",
      }),
    ],
  );

  const valuation = recoverEvidence("L'économie de la mode africaine est évaluée à 31 milliards de dollars.", "statistic", english);
  assert.equal(valuation?.fact.status, "PARTIALLY_VERIFIED");
  assert.match(valuation!.fact.evidenceQuote, /31 billion US dollars/);

  const imports = recoverEvidence("L'Afrique importe environ 23 milliards de dollars de vêtements et de tissus par an.", "statistic", english);
  assert.match(imports!.fact.evidenceQuote, /imports about 23 billion/, "each claim must land on its own figure, not the other one");

  const invented = recoverEvidence("L'Afrique importe environ 40 milliards de dollars de vêtements.", "statistic", english);
  assert.equal(invented, undefined, "a figure present in no fact recovers nothing, cross-language or not");
});

// ---------------------------------------------------------------------------
// B — new relations that the evidence does not state
// ---------------------------------------------------------------------------

test("B — the brief's own example: succession may be stated, causality may not be inferred", () => {
  const succession = fact({
    fact: "She worked at Fendi, then at Dior",
    category: "general",
    evidenceQuote: "She worked at Fendi, then at Dior",
    evidenceTranslation: "Elle a travaillé chez Fendi, puis chez Dior",
  });

  assert.ok(recoverEvidence("Elle a travaillé chez Fendi, puis chez Dior.", "general", pack([succession])), "the plain succession is fine");
  assert.equal(
    recoverEvidence("Son expérience chez Fendi l'a conduite chez Dior.", "general", pack([succession])),
    undefined,
    "the causal link is absent from the evidence and must not be inherited",
  );
});

test("B — a causal claim recovers when the evidence itself is causal", () => {
  const causal = fact({
    fact: "The appointment was driven by the brand's accessories strategy",
    category: "general",
    evidenceQuote: "the appointment was driven by the brand's accessories strategy",
    evidenceTranslation: "la nomination s'explique par la stratégie accessoires de la marque",
  });
  assert.ok(recoverEvidence("La nomination s'explique par la stratégie accessoires de la marque.", "general", pack([causal])));
});

test("B — assertsUnsupportedRelation flags a relation the cited evidence never states", () => {
  assert.equal(assertsUnsupportedRelation("Son passage chez Fendi l'a conduite chez Dior.", ["She worked at Fendi, then at Dior"]), true);
  assert.equal(assertsUnsupportedRelation("Elle a travaillé chez Fendi, puis chez Dior.", ["She worked at Fendi, then at Dior"]), false);
  assert.equal(assertsUnsupportedRelation("La hausse s'explique par la demande.", ["the rise was due to demand"]), false);
});

// ---------------------------------------------------------------------------
// C — deterministic equivalences
// ---------------------------------------------------------------------------

test("C — the three required equivalences hold", () => {
  const same = (a: string, b: string) => assert.deepEqual(extractComparableTokens(a), extractComparableTokens(b), `${a} != ${b}`);
  same("496,000 visitors", "496 000 visiteurs");
  same("at 2 p.m.", "à 14 heures");
  same("Spring/Summer 2026", "SS26");
});

test("C — values that genuinely differ never collapse", () => {
  const differ = (a: string, b: string) => assert.notDeepEqual(extractComparableTokens(a), extractComparableTokens(b), `${a} must differ from ${b}`);
  differ("2026", "2023");
  differ("496 000", "497 000");
  differ("14 heures", "15 heures");
  differ("SS26", "SS25");
});

test("C — a season shorthand does not make an unrelated number match a year", () => {
  const grounded = new Set(extractComparableTokens("la collection Spring/Summer 2026"));
  assert.ok(grounded.has("season:SS2026"));
  assert.ok(!grounded.has("26"), "a bare 26 must not become grounded by a season mention");
  assert.deepEqual(extractComparableTokens("26 créateurs"), ["26"]);
});

// ---------------------------------------------------------------------------
// SEO — length auto-correction
// ---------------------------------------------------------------------------

test("SEO — an overlong title is trimmed at a word boundary and never padded when short", () => {
  const long = "Lagos Fashion Week SS26 : le raffia, les cauris et la relecture des codes du luxe africain contemporain";
  const trimmed = trimToLimit(long, SEO_TITLE_MAX);
  assert.ok(trimmed.length <= SEO_TITLE_MAX);
  assert.ok(long.startsWith(trimmed), "trimming only removes trailing text, it never rewrites");
  assert.ok(!trimmed.endsWith(" ") && !trimmed.endsWith(","));

  const short = "Un titre court";
  assert.equal(trimToLimit(short, SEO_TITLE_MAX), short, "a short field is left exactly as written");
});

test("SEO — an overlong description is trimmed under the limit", () => {
  const long = "a".repeat(40) + " " + "b".repeat(200);
  assert.ok(trimToLimit(long, SEO_DESCRIPTION_MAX).length <= SEO_DESCRIPTION_MAX);
});

test("relation markers are detected across both languages", () => {
  assert.equal(containsRelationMarker("la croissance en raison de la demande"), true);
  assert.equal(containsRelationMarker("growth due to demand"), true);
  assert.equal(containsRelationMarker("le salon ouvre le 22 septembre"), false);
});
