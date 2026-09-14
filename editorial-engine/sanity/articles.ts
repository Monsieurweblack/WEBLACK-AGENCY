import crypto from "node:crypto";
import type { GeneratedArticle } from "../generation/types.ts";
import { getSanityClient } from "./client.ts";
import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";

/**
 * Author and category in the real `journal` schema are plain fields
 * (`author`: required string, `category`: string from a fixed list) — NOT
 * references to separate Author/Category documents. So there is nothing to
 * "get or create": `createOrGetAuthor`/`createOrGetCategory` from the brief
 * don't apply to this schema and are deliberately not implemented as
 * document-creating functions (doing so would invent a schema relationship
 * that isn't there). Category membership is validated in
 * validation/qualityCheck.ts instead.
 */

export async function findArticleBySlug(slug: string, lang: "fr" | "en"): Promise<{ _id: string } | null> {
  const client = getSanityClient();
  const result = await client.fetch<{ _id: string } | null>(
    `*[_type == "journal" && lang == $lang && slug.current == $slug][0]{ _id }`,
    { lang, slug },
  );
  return result;
}

export async function findSimilarArticles(titleTokens: string[]): Promise<{ _id: string; title: string }[]> {
  const client = getSanityClient();
  if (titleTokens.length === 0) return [];
  const pattern = titleTokens.map((t) => `*${t}*`);
  return client.fetch(`*[_type == "journal" && title match $pattern]{ _id, title }`, { pattern });
}

/**
 * Uploads an image asset ONLY when the caller has already verified reuse
 * rights (Phase 11) — never called speculatively. Returns the Sanity asset
 * document, for use in a `journal.body` image block (the schema's inline
 * body images use a native uploaded asset; the top-level `coverImage` field
 * is a separate `externalImage` URL type and does not need this).
 */
export async function uploadImageFromUrl(
  url: string,
  license: { verified: true; source: string },
): Promise<{ _id: string; _type: "reference" }> {
  if (!license.verified) {
    throw new Error("uploadImageFromUrl appelé sans licence vérifiée — refusé (voir Phase 11, docs EDITORIAL_ENGINE.md).");
  }
  const client = getSanityClient();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement de l'image échoué (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const asset = await client.assets.upload("image", buffer, { source: { id: crypto.randomUUID(), name: license.source, url } });
  return { _id: asset._id, _type: "reference" };
}

/**
 * Creates the journal document. `asDraft: true` writes it under Sanity's
 * native `drafts.<id>` id (Studio shows it as an unpublished draft — there
 * is no `status` field in this schema, draft/published is handled entirely
 * by Sanity's own id convention). `asDraft: false` writes the published id
 * directly.
 */
export async function createArticle(article: GeneratedArticle, opts: { asDraft: boolean }): Promise<{ documentId: string }> {
  const config = loadConfig();
  if (!article.author || article.author !== config.defaultAuthor) {
    // `author` in this schema is a plain string, never a reference — there is no author document to create or look up. This guard just confirms the value about to be written is exactly the configured signature, never empty and never silently substituted.
    throw new Error(
      `Auteur invalide sur le document à créer ("${article.author}") — attendu exactement EDITORIAL_DEFAULT_AUTHOR ("${config.defaultAuthor}"). Écriture refusée.`,
    );
  }
  const client = getSanityClient();
  const baseId = `journal-editorial-engine-${crypto.randomUUID()}`;
  const _id = opts.asDraft ? `drafts.${baseId}` : baseId;

  const doc: Record<string, unknown> & { _type: "journal" } = {
    _id,
    _type: "journal",
    lang: article.lang,
    title: article.title,
    slug: { _type: "slug", current: article.slug },
    excerpt: article.excerpt,
    category: article.category,
    publishDate: article.publishDate,
    author: article.author,
    featured: false,
    body: article.body,
  };
  if (article.format) doc.format = article.format;
  if (article.coverImage) doc.coverImage = { _type: "externalImage", ...article.coverImage };
  if (article.seo) doc.seo = { _type: "seo", ...article.seo };

  log("SANITY", `Création document ${_id} (${opts.asDraft ? "draft" : "publié"})`);
  const created = await client.create(doc);
  return { documentId: created._id };
}

export async function updateArticle(documentId: string, patch: Record<string, unknown>): Promise<void> {
  const client = getSanityClient();
  log("SANITY", `Mise à jour document ${documentId}`);
  await client.patch(documentId).set(patch).commit();
}

/**
 * Promotes a draft created by this engine (`drafts.journal-editorial-engine-...`)
 * to a published document — the explicit, human-triggered action behind
 * `npm run editorial:publish`. Standard Sanity publish pattern: recreate the
 * same content under the id without the `drafts.` prefix, then delete the
 * draft, as one transaction.
 */
export async function publishDraft(draftDocumentId: string): Promise<{ documentId: string }> {
  if (!draftDocumentId.startsWith("drafts.")) {
    throw new Error(`"${draftDocumentId}" n'est pas un id de brouillon (doit commencer par "drafts.").`);
  }
  const client = getSanityClient();
  const draft = await client.getDocument(draftDocumentId);
  if (!draft) throw new Error(`Brouillon introuvable: ${draftDocumentId}`);

  const publishedId = draftDocumentId.replace(/^drafts\./, "");
  const { _id, _rev, ...rest } = draft as Record<string, unknown> & { _id: string; _rev: string; _type: string };

  log("SANITY", `Publication ${draftDocumentId} → ${publishedId}`);
  await client
    .transaction()
    .createOrReplace({ _id: publishedId, ...rest })
    .delete(draftDocumentId)
    .commit();

  return { documentId: publishedId };
}
