import type { GeneratedArticle } from "../generation/types.ts";

export interface Newsletter {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  articleUrl: string;
}

/**
 * Builds the newsletter for a published article.
 *
 * Deliberately NOT a model call. Everything an issue needs — a subject, a
 * standfirst, an opening — already exists in the article, which has been
 * through claim verification, adversarial fact-checking, anti-fabrication
 * and the quality gates. Asking a model to rewrite that into a "catchier"
 * subject line would reopen, in the one artefact that lands directly in a
 * reader's inbox and cannot be edited after sending, exactly the
 * hallucination surface the whole pipeline exists to close. So the subject
 * IS the title, the preheader IS the excerpt, and the body quotes the
 * article's own opening paragraphs verbatim.
 */
export function buildNewsletter(article: GeneratedArticle, siteUrl: string): Newsletter {
  const articleUrl = `${siteUrl.replace(/\/$/, "")}/journal/${article.slug}/`;

  const paragraphs = article.body
    .filter((block): block is Extract<typeof block, { _type: "block" }> => block._type === "block")
    .filter((block) => block.style === "normal")
    .map((block) => block.children.map((child) => child.text).join("").trim())
    .filter((text) => text.length > 0);

  // The references block is useful on the page and noise in an inbox.
  const readable = paragraphs.filter((p) => !p.startsWith("Sources consultées") && !p.startsWith("—"));
  const opening = readable.slice(0, 2);

  return {
    subject: article.title,
    preheader: article.excerpt,
    articleUrl,
    text: buildText(article, opening, articleUrl),
    html: buildHtml(article, opening, articleUrl),
  };
}

function buildText(article: GeneratedArticle, opening: string[], articleUrl: string): string {
  return [
    "WEBLACK — Journal",
    "",
    article.title,
    "",
    article.excerpt,
    "",
    ...opening.flatMap((p) => [p, ""]),
    `Lire l'article complet : ${articleUrl}`,
    "",
    `— ${article.author}`,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Table-based layout with inline styles: the only thing that renders
 * consistently across Outlook, Gmail and Apple Mail. Palette follows the
 * brand — off-white ground, near-black text, gold used once, on the rule
 * above the signature.
 */
function buildHtml(article: GeneratedArticle, opening: string[], articleUrl: string): string {
  const paragraphs = opening
    .map((p) => `<p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:#2b2b2b;">${escapeHtml(p)}</p>`)
    .join("");

  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(article.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f3f1;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(article.excerpt)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f1;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
      <tr><td style="padding:32px 32px 0;">
        <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a8577;">WEBLACK — Journal</p>
      </td></tr>
      <tr><td style="padding:24px 32px 0;">
        <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:600;color:#141414;">${escapeHtml(article.title)}</h1>
      </td></tr>
      <tr><td style="padding:16px 32px 0;">
        <p style="margin:0 0 24px;font-size:17px;line-height:1.6;color:#57534b;">${escapeHtml(article.excerpt)}</p>
      </td></tr>
      <tr><td style="padding:0 32px;">${paragraphs}</td></tr>
      <tr><td style="padding:8px 32px 32px;">
        <a href="${escapeHtml(articleUrl)}" style="display:inline-block;padding:13px 26px;background:#141414;color:#ffffff;text-decoration:none;font-size:14px;letter-spacing:0.04em;">Lire l'article complet</a>
      </td></tr>
      <tr><td style="padding:0 32px 32px;">
        <div style="border-top:1px solid #c2a24d;padding-top:16px;">
          <p style="margin:0;font-size:13px;color:#8a8577;">${escapeHtml(article.author)} — ${escapeHtml(article.publishDate)}</p>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
