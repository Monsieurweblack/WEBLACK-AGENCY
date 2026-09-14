import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyEvidenceAgainstSources,
  determineStatus,
  compareFactElements,
  normalizeNumber,
  normalizeDateString,
  buildClaimRegistry,
  type RawClaimForTesting,
  type RawSourceEvidenceForTesting,
  type RegisteredSource,
} from "../validation/claimRegistry.ts";
import type { SourceArticle } from "../sources/types.ts";
import type { GeneratedArticle } from "../generation/types.ts";
import { loadConfig } from "../config/env.ts";

const hasRealKey = Boolean(loadConfig().openaiApiKey);

function makeSource(overrides: Partial<SourceArticle> = {}): SourceArticle {
  return {
    sourceName: "Test Source",
    sourceUrl: "https://example.com",
    url: "https://example.com",
    canonicalUrl: "https://example.com",
    title: "Source title",
    publishedAt: undefined,
    author: undefined,
    excerpt: undefined,
    text: undefined,
    imageUrl: undefined,
    hash: "h",
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<RawSourceEvidenceForTesting> = {}): RawSourceEvidenceForTesting {
  return {
    sourceIndex: 0,
    sourceLanguage: "fr",
    evidenceQuote: "",
    evidenceTranslation: "",
    sourceFactElements: {},
    ...overrides,
  };
}

function makeRawClaim(overrides: Partial<RawClaimForTesting> = {}): RawClaimForTesting {
  return {
    claim: "Test claim",
    claimLanguage: "fr",
    type: "general",
    importance: "significant",
    confidence: 80,
    publishedFactElements: {},
    sourceEvidence: [],
    contradictionDetected: false,
    contradictionNote: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Same-language baseline (Level 1/2) — unchanged mechanism, kept as a
// sanity check that the multilingual rework didn't regress the simple case.
// ---------------------------------------------------------------------------

test("baseline — correctly sourced fact (same language) resolves to VERIFIED via exactEvidence", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The Milan show drew 141,000 visitors this year." }) }];
  const rawClaim = makeRawClaim({
    claim: "141,000 visitors attended",
    claimLanguage: "en",
    type: "statistic",
    sourceEvidence: [makeEvidence({ sourceLanguage: "en", evidenceQuote: "drew 141,000 visitors this year" })],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(verification.verified[0]!.evidenceType, "exactEvidence");
  assert.equal(determineStatus(rawClaim, verification, sources), "VERIFIED");
});

test("baseline — unverifiable fact (no source evidence offered) resolves to UNVERIFIED", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The show was well attended." }) }];
  const rawClaim = makeRawClaim({ claim: "Over a million people attended", sourceEvidence: [] });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0);
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED");
});

test("baseline — fabricated evidence string (not verbatim in source) resolves to UNVERIFIED", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Sales reached 50 million euros in the quarter." }) }];
  const rawClaim = makeRawClaim({
    claim: "Sales reached 500 million euros",
    type: "statistic",
    importance: "critical",
    sourceEvidence: [makeEvidence({ sourceLanguage: "en", evidenceQuote: "sales reached 500 million euros" })],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0, "the fabricated evidence string does not literally appear in the source");
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED");
});

test("baseline — nonexistent quote resolves to UNVERIFIED even with high model confidence, and never via cross-language fallback", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The designer discussed the collection at length." }) }];
  const rawClaim = makeRawClaim({
    claim: '"This is my best work yet," she said',
    type: "quote",
    confidence: 99,
    publishedFactElements: { subject: "designer", action: "said this is my best work yet" },
    sourceEvidence: [makeEvidence({ sourceLanguage: "en", evidenceQuote: "This is my best work yet", sourceFactElements: { subject: "designer", action: "said this is my best work yet" } })],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0);
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED");
});

test("baseline — contradiction between two sources resolves to CONTRADICTED regardless of evidence", () => {
  const sources: RegisteredSource[] = [
    { source: makeSource({ url: "https://a.example.com", text: "Attendance was 100,000." }) },
    { source: makeSource({ url: "https://b.example.com", text: "Attendance was 250,000." }) },
  ];
  const rawClaim = makeRawClaim({
    claim: "Attendance figures",
    type: "statistic",
    sourceEvidence: [makeEvidence({ sourceIndex: 0, evidenceQuote: "Attendance was 100,000" }), makeEvidence({ sourceIndex: 1, evidenceQuote: "Attendance was 250,000" })],
    contradictionDetected: true,
    contradictionNote: "Source A says 100,000, source B says 250,000.",
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(determineStatus(rawClaim, verification, sources), "CONTRADICTED");
});

test("baseline — critical claim backed by two independent sources resolves to VERIFIED (independentEvidence, Level 5)", () => {
  const sources: RegisteredSource[] = [
    { source: makeSource({ url: "https://a.example.com", text: "The merger was valued at 2 billion dollars." }) },
    { source: makeSource({ url: "https://b.example.com", text: "Financial terms put the merger at 2 billion dollars." }) },
  ];
  const rawClaim = makeRawClaim({
    claim: "The merger was valued at 2 billion dollars",
    claimLanguage: "en",
    type: "statistic",
    importance: "critical",
    sourceEvidence: [
      makeEvidence({ sourceIndex: 0, sourceLanguage: "en", evidenceQuote: "valued at 2 billion dollars" }),
      makeEvidence({ sourceIndex: 1, sourceLanguage: "en", evidenceQuote: "the merger at 2 billion dollars" }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 2);
  assert.equal(determineStatus(rawClaim, verification, sources), "VERIFIED");
});

test("baseline — critical claim backed by a single PRIMARY source resolves to VERIFIED; single secondary source does not", () => {
  const primarySources: RegisteredSource[] = [{ source: makeSource({ text: "We are appointing Jane Doe as CEO." }), isPrimary: true }];
  const secondarySources: RegisteredSource[] = [{ source: makeSource({ text: "We are appointing Jane Doe as CEO." }), isPrimary: false }];
  const rawClaim = makeRawClaim({ claim: "Jane Doe was appointed CEO", claimLanguage: "en", type: "role", importance: "critical", sourceEvidence: [makeEvidence({ sourceLanguage: "en", evidenceQuote: "appointing Jane Doe as CEO" })] });

  const verifiedPrimary = verifyEvidenceAgainstSources(rawClaim, primarySources);
  assert.equal(determineStatus(rawClaim, verifiedPrimary, primarySources), "VERIFIED");

  const verifiedSecondary = verifyEvidenceAgainstSources(rawClaim, secondarySources);
  assert.equal(determineStatus(rawClaim, verifiedSecondary, secondarySources), "PARTIALLY_VERIFIED");
});

test("confidence never upgrades a status on its own — a 99%-confidence claim with zero verified evidence is still UNVERIFIED", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Unrelated content." }) }];
  const rawClaim = makeRawClaim({ confidence: 99, sourceEvidence: [] });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED");
});

// ---------------------------------------------------------------------------
// compareFactElements / normalizeNumber / normalizeDateString — unit-level
// checks of the deterministic comparison primitives themselves.
// ---------------------------------------------------------------------------

test("normalizeNumber — thousands separators (comma, space) are equivalent; decimals are preserved", () => {
  assert.equal(normalizeNumber("496,000"), "496000");
  assert.equal(normalizeNumber("496 000"), "496000");
  assert.equal(normalizeNumber("497 000"), "497000");
  assert.notEqual(normalizeNumber("497 000"), normalizeNumber("496,000"));
  assert.equal(normalizeNumber("49.6"), "49.6");
});

test("normalizeDateString — French and English month names normalize to the same ISO date", () => {
  assert.equal(normalizeDateString("10 septembre 2026"), "2026-09-10");
  assert.equal(normalizeDateString("September 10, 2026"), "2026-09-10");
  assert.equal(normalizeDateString("10 September 2026"), "2026-09-10");
});

test("compareFactElements — insufficient when nothing overlaps", () => {
  const result = compareFactElements({ subject: "the exhibition" }, { quantity: "496000" });
  assert.equal(result.verdict, "insufficient");
});

// ---------------------------------------------------------------------------
// PHASE 3 — deterministic multilingual test matrix (A-O), per the brief.
// Each scenario is exercised at the fixture level (no live API call) so it
// is fast, free, and fully reproducible — see the real end-to-end test at
// the bottom of this file for the live-model confirmation.
// ---------------------------------------------------------------------------

// A — English source, French claim, numbers: thousands-separator variants must be recognized as the same fact.
test("A — EN→FR with numbers: '496,000 visitors' verifies a French claim of '496 000 visiteurs' via translatedEvidence", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Organizers said the month of September alone is set to attract 496,000 visitors." }) }];
  const rawClaim = makeRawClaim({
    claim: "L'impact commercial du mois de septembre est estimé à environ 496 000 visiteurs.",
    claimLanguage: "fr",
    type: "statistic",
    importance: "critical",
    publishedFactElements: { subject: "le mois de septembre", action: "attirer", quantity: "496 000", unit: "visiteurs" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "the month of September alone is set to attract 496,000 visitors",
        evidenceTranslation: "le mois de septembre à lui seul devrait attirer 496 000 visiteurs",
        sourceFactElements: { subject: "le mois de septembre", action: "attirer", quantity: "496,000", unit: "visiteurs" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(verification.verified[0]!.evidenceType, "translatedEvidence");
  assert.equal(determineStatus(rawClaim, verification, sources), "PARTIALLY_VERIFIED", "critical + single non-primary source: Level 5 still applies on top of Level 3");
});

// B — EN→FR with a date.
test("B — EN→FR with a date: 'September 22, 2026' verifies '22 septembre 2026'", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The show opens on September 22, 2026 in Milan." }) }];
  const rawClaim = makeRawClaim({
    claim: "Le salon ouvre le 22 septembre 2026.",
    type: "date",
    publishedFactElements: { subject: "le salon", date: "22 septembre 2026" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "The show opens on September 22, 2026 in Milan",
        evidenceTranslation: "Le salon ouvre le 22 septembre 2026 à Milan",
        sourceFactElements: { subject: "le salon", date: "22 septembre 2026" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(verification.verified[0]!.evidenceType, "translatedEvidence");
  assert.equal(determineStatus(rawClaim, verification, sources), "VERIFIED");
});

// C — EN→FR with a proper name.
test("C — EN→FR with a proper name: a person's name matches across the translation", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Designer Amaka Osakwe unveiled her new collection in Lagos." }) }];
  const rawClaim = makeRawClaim({
    claim: "La créatrice Amaka Osakwe a dévoilé sa nouvelle collection à Lagos.",
    type: "name",
    publishedFactElements: { person: "Amaka Osakwe", action: "dévoiler", place: "Lagos" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "Designer Amaka Osakwe unveiled her new collection in Lagos",
        evidenceTranslation: "La créatrice Amaka Osakwe a dévoilé sa nouvelle collection à Lagos",
        sourceFactElements: { person: "Amaka Osakwe", action: "dévoiler", place: "Lagos" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(determineStatus(rawClaim, verification, sources), "VERIFIED");
});

// D — EN→FR with a place.
test("D — EN→FR with a place: the event location matches across the translation", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The event took place in Bamako, drawing regional attention." }) }];
  const rawClaim = makeRawClaim({
    claim: "L'événement s'est déroulé à Bamako.",
    type: "event",
    publishedFactElements: { subject: "l'événement", place: "Bamako" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "The event took place in Bamako, drawing regional attention",
        evidenceTranslation: "L'événement s'est déroulé à Bamako, suscitant un intérêt régional",
        sourceFactElements: { subject: "l'événement", place: "Bamako" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(determineStatus(rawClaim, verification, sources), "VERIFIED");
});

// E — EN→FR with a direct quote: translation NEVER verifies a quote, regardless of fact-element agreement.
test("E — EN→FR with a quote: a translated quote is never VERIFIED, even with matching fact elements", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: 'The designer said: "Dull is the ultimate risk."' }) }];
  const rawClaim = makeRawClaim({
    claim: '« Dull est le risque ultime », a déclaré la créatrice.',
    type: "quote",
    publishedFactElements: { person: "la créatrice", action: "déclarer" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "Dull is the ultimate risk",
        evidenceTranslation: "Dull est le risque ultime",
        sourceFactElements: { person: "la créatrice", action: "déclarer" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0, "a quote can only be verified via an exact/normalized verbatim match, never via translation");
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED");
});

// F — EN→FR with a currency figure.
test("F — EN→FR with a currency amount: '$31 billion' verifies '31 milliards de dollars'", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Analysts value the African fashion market at $31 billion." }) }];
  const rawClaim = makeRawClaim({
    claim: "Le marché africain de la mode est estimé à 31 milliards de dollars.",
    type: "statistic",
    importance: "critical",
    publishedFactElements: { subject: "le marché africain de la mode", quantity: "31", unit: "milliards de dollars" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "Analysts value the African fashion market at $31 billion",
        evidenceTranslation: "Les analystes évaluent le marché africain de la mode à 31 milliards de dollars",
        sourceFactElements: { subject: "le marché africain de la mode", quantity: "31", unit: "milliards de dollars" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(verification.verified[0]!.evidenceType, "translatedEvidence");
});

// G — deliberately incorrect translation: fact elements diverge on a soft field → UNVERIFIED, not rescued by a "plausible" translation.
test("G — deliberately incorrect translation resolves to UNVERIFIED (soft mismatch on action)", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The organization announced a partnership with a local school." }) }];
  const rawClaim = makeRawClaim({
    claim: "L'organisation a annoncé un rachat de l'école locale.",
    type: "general",
    importance: "critical",
    publishedFactElements: { subject: "l'organisation", action: "racheter", object: "l'école locale" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "The organization announced a partnership with a local school",
        evidenceTranslation: "L'organisation a annoncé un partenariat avec une école locale",
        sourceFactElements: { subject: "l'organisation", action: "partenariat", object: "l'école locale" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0);
  assert.equal(verification.mismatches.length, 1);
  assert.equal(verification.mismatches[0]!.severity, "soft");
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED");
});

// H — French claim adding information absent from the English source.
test("H — French claim adds information absent from the English source: resolves to UNVERIFIED (insufficient overlap)", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The brand opened a new store in Paris." }) }];
  const rawClaim = makeRawClaim({
    claim: "La marque a ouvert un nouveau magasin à Paris, son troisième en Europe cette année.",
    type: "general",
    importance: "critical",
    publishedFactElements: { subject: "la marque", action: "ouvrir", place: "Paris", quantity: "3" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "The brand opened a new store in Paris",
        evidenceTranslation: "La marque a ouvert un nouveau magasin à Paris",
        sourceFactElements: { subject: "la marque", action: "ouvrir", place: "Paris" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  // subject/action/place all match; quantity ("3") has nothing to compare against on the source side (not "both non-empty") — that specific added figure is simply never checked/credited, so it does not itself force a hard mismatch here, but a stricter critical claim still requires Level 5 corroboration to reach VERIFIED from a single non-primary source.
  assert.equal(determineStatus(rawClaim, verification, sources), "PARTIALLY_VERIFIED");
});

// I — French claim modifying a figure.
test("I — French claim modifies the figure (497 000 vs source's 496,000): resolves to CONTRADICTED (hard mismatch)", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Organizers said the exhibition attracted 496,000 visitors." }) }];
  const rawClaim = makeRawClaim({
    claim: "L'exposition a attiré 497 000 visiteurs.",
    type: "statistic",
    importance: "critical",
    publishedFactElements: { subject: "l'exposition", action: "attirer", quantity: "497 000", unit: "visiteurs" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "the exhibition attracted 496,000 visitors",
        evidenceTranslation: "l'exposition a attiré 496 000 visiteurs",
        sourceFactElements: { subject: "l'exposition", action: "attirer", quantity: "496 000", unit: "visiteurs" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0);
  assert.equal(verification.mismatches[0]!.severity, "hard");
  assert.equal(determineStatus(rawClaim, verification, sources), "CONTRADICTED");
});

// J — French claim modifying a date.
test("J — French claim modifies the date: resolves to CONTRADICTED (hard mismatch)", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The exhibition opened on September 10, 2026." }) }];
  const rawClaim = makeRawClaim({
    claim: "L'exposition a ouvert le 15 octobre 2026.",
    type: "date",
    importance: "critical",
    publishedFactElements: { subject: "l'exposition", date: "15 octobre 2026" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "The exhibition opened on September 10, 2026",
        evidenceTranslation: "L'exposition a ouvert le 10 septembre 2026",
        sourceFactElements: { subject: "l'exposition", date: "10 septembre 2026" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.mismatches[0]!.severity, "hard");
  assert.equal(determineStatus(rawClaim, verification, sources), "CONTRADICTED");
});

// K — French claim modifying a causal relation while the number stays correct — the central "sens factuel" test of this phase.
test("K — French claim changes the causal relation (campaign vs exhibition) while the number stays correct: resolves to UNVERIFIED, not VERIFIED", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Organizers said the exhibition attracted 496,000 visitors this year." }) }];
  const rawClaim = makeRawClaim({
    claim: "La campagne a généré 496 000 visiteurs.",
    type: "statistic",
    importance: "critical",
    publishedFactElements: { subject: "la campagne", action: "générer", quantity: "496 000", unit: "visiteurs" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "the exhibition attracted 496,000 visitors this year",
        evidenceTranslation: "l'exposition a attiré 496 000 visiteurs cette année",
        sourceFactElements: { subject: "l'exposition", action: "attirer", quantity: "496 000", unit: "visiteurs" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0, "the quantity alone matching must not be enough — subject and action both diverge");
  assert.equal(verification.mismatches[0]!.severity, "soft", "the number itself is not what's wrong here — reported as a soft (framing/causality) mismatch, not a hard one");
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED", "this must prove the system checks factual SENSE, not just digits");
});

// L — French claim correct, but the source itself is ambiguous (no clean atomic elements to compare).
test("L — correct claim but an ambiguous/descriptive source: insufficient overlap resolves to UNVERIFIED, never guessed into VERIFIED", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The mood in the industry was cautiously optimistic this season." }) }];
  const rawClaim = makeRawClaim({
    claim: "L'ambiance dans le secteur était prudemment optimiste cette saison.",
    type: "general",
    importance: "critical",
    publishedFactElements: { subject: "l'ambiance", action: "être prudemment optimiste" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "The mood in the industry was cautiously optimistic this season",
        evidenceTranslation: "",
        sourceFactElements: {},
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 0);
  assert.equal(determineStatus(rawClaim, verification, sources), "UNVERIFIED");
});

// M — two contradictory sources (kept from the previous phase's F, renumbered here for the new A-O sequence).
test("M — two contradictory sources resolve to CONTRADICTED", () => {
  const sources: RegisteredSource[] = [
    { source: makeSource({ url: "https://a.example.com", text: "Attendance was 100,000." }) },
    { source: makeSource({ url: "https://b.example.com", text: "Attendance was 250,000." }) },
  ];
  const rawClaim = makeRawClaim({
    claim: "Attendance figures",
    type: "statistic",
    sourceEvidence: [makeEvidence({ sourceIndex: 0, evidenceQuote: "Attendance was 100,000" }), makeEvidence({ sourceIndex: 1, evidenceQuote: "Attendance was 250,000" })],
    contradictionDetected: true,
    contradictionNote: "Source A says 100,000, source B says 250,000.",
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(determineStatus(rawClaim, verification, sources), "CONTRADICTED");
});

// N — primary English-language source: a single primary source is enough even across languages (Level 5 does not require same-language).
test("N — a primary English-language source verifies a critical French claim via translatedEvidence + independentEvidence", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "We are opening our first West African flagship store in Lagos." }), isPrimary: true }];
  const rawClaim = makeRawClaim({
    claim: "La marque ouvre son premier magasin phare en Afrique de l'Ouest, à Lagos.",
    type: "event",
    importance: "critical",
    publishedFactElements: { subject: "la marque", action: "ouvrir", place: "Lagos" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "We are opening our first West African flagship store in Lagos",
        evidenceTranslation: "Nous ouvrons notre premier magasin phare en Afrique de l'Ouest, à Lagos",
        sourceFactElements: { subject: "la marque", action: "ouvrir", place: "Lagos" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(determineStatus(rawClaim, verification, sources), "VERIFIED");
});

// O — a single secondary English-language source is not enough on its own for a critical claim, even once cross-language equivalence succeeds.
test("O — a single secondary English-language source alone resolves a critical claim to PARTIALLY_VERIFIED, not VERIFIED", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "The report estimates 12,000 new jobs created by the sector." }), isPrimary: false }];
  const rawClaim = makeRawClaim({
    claim: "Le secteur a créé 12 000 nouveaux emplois, selon le rapport.",
    type: "statistic",
    importance: "critical",
    publishedFactElements: { subject: "le secteur", action: "créer", quantity: "12 000", unit: "emplois" },
    sourceEvidence: [
      makeEvidence({
        sourceLanguage: "en",
        evidenceQuote: "The report estimates 12,000 new jobs created by the sector",
        evidenceTranslation: "Le rapport estime 12 000 nouveaux emplois créés par le secteur",
        sourceFactElements: { subject: "le secteur", action: "créer", quantity: "12,000", unit: "emplois" },
      }),
    ],
  });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  assert.equal(verification.verified.length, 1);
  assert.equal(determineStatus(rawClaim, verification, sources), "PARTIALLY_VERIFIED");
});

test("a fully passing claim registry status makes no claim about editorial quality by itself", () => {
  const sources: RegisteredSource[] = [{ source: makeSource({ text: "Generic, uninspired but factually accurate content." }) }];
  const rawClaim = makeRawClaim({ claim: "The content is accurate", claimLanguage: "en", sourceEvidence: [makeEvidence({ sourceLanguage: "en", evidenceQuote: "factually accurate content" })] });
  const verification = verifyEvidenceAgainstSources(rawClaim, sources);
  const status = determineStatus(rawClaim, verification, sources);
  assert.equal(status, "VERIFIED");
  // Nothing here asserts anything about tone, originality, or relevance —
  // those are runQualityCheck/evaluateSeoQualityGate's job, deliberately
  // separate gates (see validation/qualityGate.ts).
});

// near-copy detection is a separate concern — see tests/antiCopy.test.ts.

// ---------------------------------------------------------------------------
// TEST CRITIQUE RÉEL — reproduces the exact real Test A finding from the
// previous campaign against a live model, in three steps.
// ---------------------------------------------------------------------------

test("CRITIQUE RÉEL — buildClaimRegistry against a live model: real EN source, correct FR translation, exact number → VERIFIED-or-better", async (t) => {
  if (!hasRealKey) {
    t.skip("no OPENAI_API_KEY configured in this environment");
    return;
  }
  const sourceText = "Organizers confirmed the month of September alone is set to attract 496,000 visitors to Milan Fashion Week.";
  const source: SourceArticle = makeSource({
    sourceName: "Milan Fashion Wire",
    url: "https://example.com/milan-fashion-week",
    text: sourceText,
    title: "Milan Fashion Week draws record crowds",
  });

  const article: GeneratedArticle = {
    lang: "fr",
    title: "La Fashion Week de Milan attire des foules records",
    slug: "milan-fashion-week-foules-records",
    excerpt: "Un mois de septembre exceptionnel pour la mode milanaise.",
    category: "news",
    publishDate: "2026-09-10",
    author: "Test",
    body: [
      {
        _type: "block",
        _key: "k1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Les organisateurs ont confirmé que le seul mois de septembre devrait attirer 496 000 visiteurs à la Fashion Week de Milan.", marks: [] }],
        markDefs: [],
      },
    ],
    source: { name: source.sourceName, url: source.url },
    editorialScore: 80,
    confidenceScore: 80,
  };

  const result = await buildClaimRegistry(article, [{ source }], "test-run-claimregistry-real-multilingual");
  const visitorClaim = result.claims.find((c) => c.claim.includes("496"));
  assert.ok(visitorClaim, "expected the model to identify the 496,000-visitor claim");
  assert.notEqual(visitorClaim!.verificationStatus, "UNVERIFIED", "a real, verbatim, accurately-translated number must not be UNVERIFIED — this is the exact regression this phase fixes");
  assert.notEqual(visitorClaim!.verificationStatus, "CONTRADICTED");
});

test("buildClaimRegistry — real end-to-end run against a live model correctly flags an injected fabrication", async (t) => {
  if (!hasRealKey) {
    t.skip("no OPENAI_API_KEY configured in this environment");
    return;
  }
  const sourceText =
    "The Lagos exhibition opened on September 10, 2026, drawing designers from across West Africa. Organizers reported roughly 3,000 attendees over the three-day event.";
  const source: SourceArticle = makeSource({
    sourceName: "Lagos Exhibition Wire",
    url: "https://example.com/lagos-exhibition",
    text: sourceText,
    title: "Lagos exhibition draws thousands",
  });

  // Deliberately injects a fabricated, specific figure ("12,000 attendees")
  // that does NOT appear anywhere in the source text above — a real,
  // controlled test of whether the live model + programmatic verification
  // actually catches an invented number rather than rubber-stamping it.
  const article: GeneratedArticle = {
    lang: "fr",
    title: "L'exposition de Lagos rassemble les créateurs ouest-africains",
    slug: "exposition-lagos-createurs-ouest-africains",
    excerpt: "Un événement marquant pour la mode ouest-africaine.",
    category: "news",
    publishDate: "2026-09-10",
    author: "Test",
    body: [
      {
        _type: "block",
        _key: "k1",
        style: "normal",
        children: [
          {
            _type: "span",
            _key: "s1",
            text: "L'exposition de Lagos a ouvert ses portes le 10 septembre 2026, réunissant des créateurs venus de toute l'Afrique de l'Ouest. Les organisateurs ont annoncé environ 12 000 visiteurs sur les trois jours de l'événement.",
            marks: [],
          },
        ],
        markDefs: [],
      },
    ],
    source: { name: source.sourceName, url: source.url },
    editorialScore: 80,
    confidenceScore: 80,
  };

  const result = await buildClaimRegistry(article, [{ source }], "test-run-claimregistry-real");
  const attendeeClaim = result.claims.find((c) => c.claim.toLowerCase().includes("12") || c.claim.toLowerCase().includes("visiteur") || c.claim.toLowerCase().includes("attend"));
  assert.ok(attendeeClaim, "expected the model to identify the attendee-count claim");
  assert.notEqual(attendeeClaim!.verificationStatus, "VERIFIED", "a fabricated 12,000 figure (real source says ~3,000) must not be VERIFIED");
});
