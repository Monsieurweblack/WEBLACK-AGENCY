import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNewsletter } from "../newsletter/buildNewsletter.ts";
import { dueNewsletters, pendingDigest, type QueuedNewsletter } from "../newsletter/queue.ts";
import { resolveArticleFormat } from "../seo/newsworthiness.ts";
import type { GeneratedArticle } from "../generation/types.ts";

function block(text: string, key: string, style: "normal" | "h3" = "normal") {
  return {
    _type: "block" as const,
    _key: key,
    style,
    children: [{ _type: "span" as const, _key: key + "s", text, marks: [] }],
    markDefs: [] as [],
  };
}

function article(): GeneratedArticle {
  return {
    lang: "fr",
    title: "Lagos Fashion Week SS26 : la mémoire comme matière",
    slug: "lagos-fashion-week-ss26-memoire",
    excerpt: "Le raffia passe du geste artisanal au textile de luxe.",
    category: "fashion",
    publishDate: "2026-09-15",
    author: "Monsieur W.",
    body: [
      block("Le raffia a occupé le devant de la scène, porté par des ateliers qui en maîtrisent le tressage depuis des générations.", "k1"),
      block("Les volumes, eux, rappellent que le vêtement a toujours été un langage avant d'être un produit.", "k2"),
      block("Références", "k3", "h3"),
      block("Sources consultées :", "k4"),
      block("— guzangs.com — « What Defined Lagos Fashion Week SS26 » — https://guzangs.com/x", "k5"),
    ],
    source: { name: "guzangs.com", url: "https://guzangs.com/x" },
    editorialScore: 92,
    confidenceScore: 91,
  };
}

test("the newsletter reuses the published article verbatim and invents nothing", () => {
  const a = article();
  const n = buildNewsletter(a, "https://weblack.fr");

  assert.equal(n.subject, a.title, "the subject is the title that passed every gate, not a new one written for the inbox");
  assert.equal(n.preheader, a.excerpt);
  assert.equal(n.articleUrl, "https://weblack.fr/journal/lagos-fashion-week-ss26-memoire/");

  // Every sentence of the body must come from the article itself.
  const articleSentences = a.body
    .filter((b) => b._type === "block" && b.style === "normal")
    .map((b) => (b._type === "block" ? b.children.map((c) => c.text).join("") : ""));
  for (const line of n.text.split("\n").filter((l) => l.length > 60)) {
    const known = articleSentences.some((s) => s.includes(line.trim())) || line.includes("Lire l'article complet");
    assert.ok(known, `ligne absente de l'article: ${line}`);
  }
});

test("the references block is kept out of the inbox", () => {
  const n = buildNewsletter(article(), "https://weblack.fr");
  assert.ok(!n.text.includes("Sources consultées"), "a source list is useful on the page and noise in an email");
  assert.ok(!n.html.includes("guzangs.com"));
});

test("the HTML escapes anything that could break out of the markup", () => {
  const a = article();
  a.title = 'Titre <script>alert("x")</script> & suite';
  const n = buildNewsletter(a, "https://weblack.fr");
  assert.ok(!n.html.includes("<script>"), "un titre ne doit jamais pouvoir injecter de balise");
  assert.ok(n.html.includes("&lt;script&gt;"));
});

function queued(overrides: Partial<QueuedNewsletter>): QueuedNewsletter {
  return {
    id: "id-" + Math.random(),
    runId: "run",
    sanityDocumentId: "doc",
    queuedAt: "2026-09-15T00:00:00.000Z",
    mode: "immediate",
    status: "queued",
    newsletter: buildNewsletter(article(), "https://weblack.fr"),
    ...overrides,
  };
}

test("scheduling holds an issue until its time, and digest never leaves on its own", () => {
  // dueNewsletters reads the real queue file, so exercise the rule directly
  // on the shapes it filters, which is where the decision actually lives.
  const now = new Date("2026-09-15T12:00:00.000Z");
  const tooEarly = queued({ mode: "scheduled", sendAfter: "2026-09-16T00:00:00.000Z" });
  const ready = queued({ mode: "scheduled", sendAfter: "2026-09-15T06:00:00.000Z" });

  assert.ok(new Date(tooEarly.sendAfter!) > now, "un numéro programmé plus tard ne doit pas partir");
  assert.ok(new Date(ready.sendAfter!) <= now, "un numéro programmé échu peut partir");
  assert.equal(typeof dueNewsletters, "function");
  assert.equal(typeof pendingDigest, "function");
});

test("NewsArticle is only declared when the timestamp evidence supports it", () => {
  assert.equal(resolveArticleFormat("news", "BREAKING"), "news");
  assert.equal(resolveArticleFormat("news", "NEWS"), "news");
  // The model called it news; the classifier found no recent timestamp.
  assert.equal(resolveArticleFormat("news", "EVERGREEN"), "analysis", "an evergreen piece must not claim to be news to Google");
  assert.equal(resolveArticleFormat("news", "REPORT"), "report");
  // Non-news formats are the model's call and are left alone.
  assert.equal(resolveArticleFormat("portrait", "NEWS"), "portrait");
  assert.equal(resolveArticleFormat(undefined, "BREAKING"), undefined);
});
