import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerifiedFactSet, formatForWriter, isEmpty } from "../generation/verifiedFacts.ts";
import { runQualityCheck } from "../validation/qualityCheck.ts";
import type { ExtractedFacts, FactEvidence, GeneratedArticle } from "../generation/types.ts";
import type { SourceArticle } from "../sources/types.ts";

function makeSource(text: string, overrides: Partial<SourceArticle> = {}): SourceArticle {
  return {
    sourceName: "Test Wire",
    sourceUrl: "https://example.com",
    url: "https://example.com/article",
    canonicalUrl: "https://example.com/article",
    title: "Source title",
    publishedAt: undefined,
    author: undefined,
    excerpt: undefined,
    text,
    imageUrl: undefined,
    hash: "h",
    ...overrides,
  };
}

function makeFacts(factEvidence: FactEvidence[], sourceLanguage = "en"): ExtractedFacts {
  return {
    people: [],
    brands: [],
    organizations: [],
    locations: [],
    dates: [],
    numbers: [],
    events: [],
    claims: [],
    keyFacts: [],
    quotes: [],
    sourceLanguage,
    factEvidence,
  };
}

function writerSees(set: ReturnType<typeof buildVerifiedFactSet>): string {
  return formatForWriter(set);
}

// 1 — a figure that really is in the source reaches the writer. Being a
// figure it is "critical", and a single secondary source is not enough to
// assert it flatly, so it arrives flagged for cautious, attributed phrasing.
test("1 — verified figure reaches the writer, flagged as requiring attributed phrasing", () => {
  const source = makeSource("Organizers said the show attracted 141,000 visitors this year.");
  const facts = makeFacts([
    {
      fact: "The show attracted 141,000 visitors",
      category: "number",
      importance: "critical",
      evidenceQuote: "the show attracted 141,000 visitors this year",
      evidenceTranslation: "le salon a attiré 141 000 visiteurs cette année",
    },
  ]);

  const set = buildVerifiedFactSet(facts, source);
  assert.equal(set.rejected.length, 0);
  assert.equal(set.partiallyVerified.length, 1, "a critical fact from a single secondary source is partially verified, not asserted");
  assert.match(writerSees(set), /141,000 visitors/);
  assert.match(writerSees(set), /avec prudence/);
});

// 2 — a figure the source never states: the model cannot produce a real
// excerpt for it, so it is dropped before the writer sees anything.
test("2 — a figure absent from the source is dropped and never reaches the writer", () => {
  const source = makeSource("Organizers said the show was well attended this year.");
  const facts = makeFacts([
    {
      fact: "The show attracted 141,000 visitors",
      category: "number",
      importance: "critical",
      evidenceQuote: "the show attracted 141,000 visitors this year",
      evidenceTranslation: "le salon a attiré 141 000 visiteurs cette année",
    },
  ]);

  const set = buildVerifiedFactSet(facts, source);
  assert.equal(set.rejected.length, 1);
  assert.equal(set.verified.length + set.partiallyVerified.length, 0);
  assert.doesNotMatch(writerSees(set), /141,000/, "a dropped fact must not appear anywhere in what the writer is given");
  assert.ok(isEmpty(set), "nothing verifiable left: the pipeline must not write this article at all");
});

// 3 — a deliberately invented figure, with an invented supporting excerpt:
// the excerpt is checked against the real source text, so both are dropped.
test("3 — a deliberately invented figure with a fabricated excerpt is rejected", () => {
  const source = makeSource("Sales reached 50 million euros in the quarter, the group said.");
  const facts = makeFacts([
    {
      fact: "Sales reached 500 million euros in the quarter",
      category: "number",
      importance: "critical",
      evidenceQuote: "sales reached 500 million euros in the quarter",
      evidenceTranslation: "les ventes ont atteint 500 millions d'euros sur le trimestre",
    },
  ]);

  const set = buildVerifiedFactSet(facts, source);
  assert.equal(set.rejected.length, 1);
  assert.equal(set.rejected[0]!.status, "UNVERIFIED");
  assert.doesNotMatch(writerSees(set), /500 million/);
});

// 4 — English source, French article: the fact and its proof stay in the
// source's language (so verification is a plain verbatim check), and the
// working translation travels with them for the writer.
test("4 — EN source: the fact is verified against the English original and the French translation is passed to the writer", () => {
  const source = makeSource("The brand opened its first West African flagship store in Lagos last month.");
  const facts = makeFacts([
    {
      fact: "The brand opened its first West African flagship store in Lagos",
      category: "event",
      importance: "significant",
      evidenceQuote: "The brand opened its first West African flagship store in Lagos",
      evidenceTranslation: "La marque a ouvert son premier magasin phare ouest-africain à Lagos",
    },
  ]);

  const set = buildVerifiedFactSet(facts, source);
  assert.equal(set.verified.length, 1);
  const seen = writerSees(set);
  assert.match(seen, /first West African flagship store/, "the original-language proof stays the canonical one");
  assert.match(seen, /premier magasin phare ouest-africain/, "the working translation is provided alongside it");
});

// 5 — quotes: a real verbatim quote survives, an invented one does not.
test("5 — a real quote reaches the writer; an invented quote is rejected", () => {
  const source = makeSource('The designer said: "Dull is the ultimate risk." She then left the stage.');

  const realQuote = buildVerifiedFactSet(
    makeFacts([
      {
        fact: '"Dull is the ultimate risk," the designer said',
        category: "quote",
        importance: "critical",
        evidenceQuote: "Dull is the ultimate risk",
        evidenceTranslation: "L'ennui est le risque ultime",
      },
    ]),
    source,
  );
  assert.equal(realQuote.rejected.length, 0);
  assert.match(writerSees(realQuote), /Dull is the ultimate risk/);

  const inventedQuote = buildVerifiedFactSet(
    makeFacts([
      {
        fact: '"This is my best collection yet," the designer said',
        category: "quote",
        importance: "critical",
        evidenceQuote: "This is my best collection yet",
        evidenceTranslation: "C'est ma meilleure collection à ce jour",
      },
    ]),
    source,
  );
  assert.equal(inventedQuote.rejected.length, 1);
  assert.doesNotMatch(writerSees(inventedQuote), /best collection/);
});

// 6 — a causal link the source never draws: there is no real excerpt to
// support it, so it is dropped before writing.
test("6 — a causal link absent from the source is dropped before writing", () => {
  const source = makeSource("Tariffs rose in March. Separately, the agency reported a slow fourth quarter.");
  const facts = makeFacts([
    {
      fact: "The tariffs caused the agency's slow fourth quarter",
      category: "general",
      importance: "critical",
      evidenceQuote: "the tariffs caused the agency's slow fourth quarter",
      evidenceTranslation: "les droits de douane ont provoqué le trimestre difficile de l'agence",
    },
  ]);

  const set = buildVerifiedFactSet(facts, source);
  assert.equal(set.rejected.length, 1);
  assert.doesNotMatch(writerSees(set), /caused/);
});

// The boundary of this gate, recorded explicitly rather than overclaimed:
// it proves an excerpt is genuinely in the source, NOT that the excerpt
// supports the exact phrasing built on top of it. A real excerpt paired
// with an overreaching restatement passes here — and is caught after
// writing by the claim registry's atomic fact comparison (see
// tests/claimRegistry.test.ts, case K).
test("boundary — a real excerpt paired with an overreaching restatement passes this gate; the post-writing pass is what catches it", () => {
  const source = makeSource("Tariffs rose in March. Separately, the agency reported a slow fourth quarter.");
  const facts = makeFacts([
    {
      fact: "The tariffs caused the agency's slow fourth quarter",
      category: "general",
      importance: "critical",
      evidenceQuote: "Tariffs rose in March",
      evidenceTranslation: "Les droits de douane ont augmenté en mars",
    },
  ]);

  const set = buildVerifiedFactSet(facts, source);
  assert.equal(set.rejected.length, 0, "documented limitation: this gate checks the excerpt is real, not that it supports the restatement");
  assert.equal(set.partiallyVerified.length, 1, "at least it arrives flagged for cautious, attributed phrasing rather than as a plain fact");
});

function articleSaying(text: string): GeneratedArticle {
  return {
    lang: "fr",
    title: "Un titre d'article suffisamment long",
    slug: "un-titre-d-article",
    excerpt: "Un excerpt de longueur raisonnable pour passer le contrôle.",
    category: "fashion",
    publishDate: "2026-09-15",
    author: "Monsieur W.",
    body: [
      { _type: "block", _key: "k1", style: "normal", children: [{ _type: "span", _key: "s1", text, marks: [] }], markDefs: [] },
      {
        _type: "block",
        _key: "k2",
        style: "normal",
        children: [
          {
            _type: "span",
            _key: "s2",
            text: "Ce paragraphe complémentaire existe uniquement pour que l'article atteigne la longueur minimale exigée par le contrôle qualité, sans introduire la moindre donnée chiffrée supplémentaire dans le corps du texte analysé.",
            marks: [],
          },
        ],
        markDefs: [],
      },
    ],
    source: { name: "Test Wire", url: "https://example.com/article" },
    editorialScore: 80,
    confidenceScore: 80,
  };
}

// Regression: an English source writes "141,000", the French article
// correctly writes "141 000". Both must be recognized as the same figure.
test("regression — a French-formatted figure matching an English-formatted source figure is not flagged as invented", () => {
  const facts = makeFacts([
    { fact: "The show attracted 141,000 visitors", category: "number", importance: "critical", evidenceQuote: "the show attracted 141,000 visitors", evidenceTranslation: "" },
  ]);
  facts.numbers = ["141,000"];

  const result = runQualityCheck(articleSaying("Le salon a attiré 141 000 visiteurs selon la source."), facts);
  assert.ok(
    !result.errors.some((e) => e.includes("possible invention")),
    `"141 000" is the same figure as the source's "141,000" and must not be flagged: ${result.errors.join(" | ")}`,
  );
});

// Regression: a figure the writer was legitimately handed via factEvidence
// must count as grounded even when the flat arrays never listed it.
test("regression — a figure grounded only in factEvidence counts as grounded", () => {
  const facts = makeFacts([
    { fact: "Giorgio Armani presents its spring 2027 line", category: "date", importance: "significant", evidenceQuote: "Giorgio Armani presenting its women's spring 2027 line", evidenceTranslation: "" },
  ]);

  const result = runQualityCheck(articleSaying("La maison présentera sa ligne du printemps 2027 lors de la saison."), facts);
  assert.ok(
    !result.errors.some((e) => e.includes("possible invention")),
    `2027 came from a verified fact and must not be flagged: ${result.errors.join(" | ")}`,
  );
});

test("a figure genuinely absent from every fact source is still flagged", () => {
  const facts = makeFacts([
    { fact: "The show was well attended", category: "general", importance: "minor", evidenceQuote: "The show was well attended", evidenceTranslation: "" },
  ]);

  const result = runQualityCheck(articleSaying("Le salon a réuni 87 500 visiteurs cette année."), facts);
  assert.ok(result.errors.some((e) => e.includes("possible invention")), "an ungrounded figure must still be caught");
});

test("rejected facts never appear in what the writer is given, whatever their status", () => {
  const source = makeSource("The summit takes place in Gothenburg on 24 September.");
  const facts = makeFacts([
    { fact: "The summit takes place in Gothenburg", category: "location", importance: "significant", evidenceQuote: "The summit takes place in Gothenburg", evidenceTranslation: "" },
    { fact: "1,400 delegates attended", category: "number", importance: "critical", evidenceQuote: "1,400 delegates attended the summit", evidenceTranslation: "" },
    { fact: "The keynote was delivered by a minister", category: "person", importance: "significant", evidenceQuote: "the keynote was delivered by a minister", evidenceTranslation: "" },
  ]);

  const set = buildVerifiedFactSet(facts, source);
  assert.equal(set.rejected.length, 2);
  const seen = writerSees(set);
  for (const dropped of set.rejected) {
    assert.ok(!seen.includes(dropped.fact), `dropped fact leaked to the writer: ${dropped.fact}`);
  }
  assert.match(seen, /Gothenburg/);
});
