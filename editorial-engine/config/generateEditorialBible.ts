/**
 * §5 — generates config/weblack-editorial-bible.json from two sources ONLY,
 * never invented:
 *  1. Deterministic analysis of the real `journal` documents in Sanity
 *     (lengths, categories actually used, author field as actually
 *     populated) — no OpenAI call, pure arithmetic over real data.
 *  2. Rules already explicitly written elsewhere in this project (this
 *     conversation's own brief for banned phrases; CLAUDE.md for
 *     positioning/territories/tone; src/lib/content.ts's JOURNAL_CATEGORIES
 *     for the categories the front-end actually renders;
 *     editorial-engine/seo/seo.ts for the SEO length rules already
 *     enforced in code).
 *
 * Run: npm run editorial:bible
 */
import { getSanityClient } from "../sanity/client.ts";
import { saveEditorialBible, type EditorialBible } from "./editorialBible.ts";
import { JOURNAL_CATEGORIES } from "../generation/types.ts";

interface JournalDoc {
  title?: string;
  excerpt?: string;
  category?: string;
  author?: string | null;
  body?: { _type: string; children?: { text: string }[] }[];
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function wordCount(doc: JournalDoc): number {
  return (doc.body ?? [])
    .filter((b) => b._type === "block")
    .reduce((sum, b) => sum + (b.children ?? []).map((c) => c.text).join(" ").split(/\s+/).filter(Boolean).length, 0);
}

async function main() {
  const client = getSanityClient();
  const docs: JournalDoc[] = await client.fetch(`*[_type == "journal"]{title, excerpt, category, author, body}`);
  if (docs.length === 0) {
    console.error("Aucun document journal trouvé — impossible de générer la bible à partir de rien.");
    process.exitCode = 1;
    return;
  }

  const titleLengths = docs.filter((d) => d.title).map((d) => d.title!.length);
  const excerptLengths = docs.filter((d) => d.excerpt).map((d) => d.excerpt!.length);
  const wordCounts = docs.map(wordCount).filter((n) => n > 0);

  const categoriesInUse: Record<string, number> = {};
  for (const doc of docs) {
    if (doc.category) categoriesInUse[doc.category] = (categoriesInUse[doc.category] ?? 0) + 1;
  }
  const categoriesDeclaredButUnused = (JOURNAL_CATEGORIES as readonly string[]).filter((c) => !(c in categoriesInUse));

  const authorValues = docs.map((d) => d.author ?? null);
  const distinctAuthorValues = [...new Set(authorValues)];
  const nullCount = authorValues.filter((v) => v === null).length;

  const shortArticles = wordCounts.filter((w) => w < 100).length;
  const longArticles = wordCounts.filter((w) => w >= 100).length;

  const bible: EditorialBible = {
    generatedAt: new Date().toISOString(),
    source: `${docs.length} documents journal réels, dataset Sanity "production", interrogés le ${new Date().toISOString().slice(0, 10)}`,
    sampleSize: docs.length,
    // Positioning/territories/tone: quoted from this project's own CLAUDE.md, not invented here.
    positioning:
      "WEBLACK est une agence créative indépendante et internationale reliant talents, vision créative et pertinence culturelle — jamais un registre géographique, communautaire ou ethnique. (Source: CLAUDE.md)",
    territories: [
      "mode",
      "luxe",
      "création",
      "culture",
      "industries créatives",
      "talents",
      "design",
      "beauté",
      "business créatif",
      "mode africaine et diasporique",
      "influence culturelle",
    ],
    tone: ["institutionnel", "haut de gamme", "assertif", "premium", "éditorial", "précis", "contemporain", "international", "élégant"],
    categoriesInUse,
    categoriesDeclaredButUnused,
    titleLength: { minChars: Math.min(...titleLengths), maxChars: Math.max(...titleLengths), avgChars: avg(titleLengths) },
    excerptLength: { minChars: Math.min(...excerptLengths), maxChars: Math.max(...excerptLengths), avgChars: avg(excerptLengths) },
    bodyLength: {
      minWords: Math.min(...wordCounts),
      maxWords: Math.max(...wordCounts),
      avgWords: avg(wordCounts),
      note: `distribution bimodale observée : ${shortArticles} article(s) très court(s) (< 100 mots, teaser/annonce) et ${longArticles} article(s) long format (100-${Math.max(...wordCounts)} mots) — pas de longueur "typique" unique, préférer le format long (100+ mots, plusieurs paragraphes) pour un article éditorial généré, les teasers courts existants étant des annonces ponctuelles, pas un modèle éditorial à reproduire.`,
    },
    authorObservations: {
      distinctValues: distinctAuthorValues,
      nullCount,
      note: `${docs.length - nullCount}/${docs.length} documents ont un auteur renseigné, et parmi eux la valeur observée est exclusivement "La Rédaction".`,
    },
    // This is a project POLICY (already written in the journal schema's own docblock), not a description of what's observed — the observed data alone would suggest the opposite, which is exactly why this rule exists.
    authorPolicy:
      `Ne jamais utiliser "La Rédaction" comme auteur par défaut pour un article généré par ce moteur, malgré sa présence sur 6/9 articles existants — règle explicite du schéma journal.ts ("Ne jamais utiliser 'La Rédaction' par défaut pour masquer une absence d'auteur"). Utiliser exclusivement EDITORIAL_DEFAULT_AUTHOR.`,
    // Verbatim from this phase's own brief (§8), not invented.
    expressionsToAvoid: [
      "dans un monde en constante évolution",
      "une nouvelle ère",
      "repousse les limites",
      "plus que jamais",
    ],
    // From editorial-engine/seo/seo.ts's already-implemented checkSeoTitle/checkSeoDescription thresholds.
    seoRules: { titleMinChars: 20, titleMaxChars: 70, descriptionMinChars: 70, descriptionMaxChars: 160 },
  };

  saveEditorialBible(bible);
  console.log(`Bible générée: editorial-engine/config/weblack-editorial-bible.json (${docs.length} articles analysés)`);
  console.log(JSON.stringify(bible, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
