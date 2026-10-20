/**
 * Le contrôle post-build des pages publiques détecte bien ce qu'il doit
 * détecter — testé sur des sites miniatures générés dans un dossier temporaire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPage, checkPublicPages, REQUIRED_PAGES, SITE } from "./publicPages.mjs";

const filler = (n) => "Texte descriptif réel de la page. ".repeat(Math.ceil(n / 33));

function pageHtml(page, { extra = "", canonical = `${SITE}${page.path}`, noindex = false } = {}) {
  const privacy = page.privacyLink ? `<a href="${page.privacyLink}">Politique</a>` : "";
  const required = [...(page.mentions ?? []), page.limitedUse ? "including the Limited Use requirements" : ""].join(" ");
  return `<!doctype html><html lang="${page.lang}"><head><link rel="canonical" href="${canonical}">${noindex ? '<meta name="robots" content="noindex">' : ""}</head><body><h1>Titre</h1><p>${filler(page.minText)} ${required}</p>${privacy}${extra}</body></html>`;
}

function buildSite(mutate = () => undefined) {
  const dist = mkdtempSync(join(tmpdir(), "weblack-dist-"));
  for (const page of REQUIRED_PAGES) {
    const dir = join(dist, ...page.path.split("/").filter(Boolean));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), mutate(page) ?? pageHtml(page));
  }
  return dist;
}

test("un site conforme passe le contrôle", () => {
  assert.deepEqual(checkPublicPages(buildSite()), []);
});

test("page publique absente, noindex, mauvais canonical ou contenu trop court : signalés", () => {
  const plateforme = REQUIRED_PAGES.find((p) => p.path === "/talent/plateforme/");
  assert.ok(checkPage(pageHtml(plateforme, { noindex: true }), plateforme).some((p) => p.includes("noindex")));
  assert.ok(checkPage(pageHtml(plateforme, { canonical: "https://www.weblack.fr/talent/plateforme/" }), plateforme).some((p) => p.includes("canonical")));
  assert.ok(checkPage(`<html lang="fr"><h1>x</h1></html>`, plateforme).some((p) => p.includes("contenu trop court")));
  const missing = checkPublicPages(buildSite((page) => (page.path === "/en/politique-de-confidentialite/" ? "" : undefined)));
  assert.ok(missing.some((p) => p.startsWith("/en/politique-de-confidentialite/")));
});

test("page derrière une connexion (champ mot de passe ou redirection) : signalée", () => {
  const home = REQUIRED_PAGES[0];
  assert.ok(checkPage(pageHtml(home, { extra: '<input type="password">' }), home).some((p) => p.includes("mot de passe")));
  assert.ok(checkPage(pageHtml(home, { extra: '<meta http-equiv="refresh" content="0;url=/admin/candidatures/">' }), home).some((p) => p.includes("connexion")));
});

test("lien vers la politique de confidentialité et déclaration Limited Use exigés", () => {
  const plateforme = REQUIRED_PAGES.find((p) => p.path === "/talent/plateforme/");
  const html = pageHtml(plateforme).replace(`href="${plateforme.privacyLink}"`, 'href="/ailleurs"').replace("Limited Use", "usage");
  const problems = checkPage(html, plateforme);
  assert.ok(problems.some((p) => p.includes("aucun lien vers /politique-de-confidentialite")));
  assert.ok(problems.some((p) => p.includes("Limited Use")));
});

test("secret publié ou raison sociale hors mentions légales : bloquant", () => {
  const dist = buildSite();
  mkdirSync(join(dist, "_astro"), { recursive: true });
  writeFileSync(join(dist, "_astro", "app.js"), 'const s = "GOCSPX-abcdefghijklmnopqrstuv";');
  writeFileSync(join(dist, "fuite.json"), '{"t":"1//0gAbCdEfGhIjKlMnOpQrStUvWxYz"}');
  mkdirSync(join(dist, "journal"), { recursive: true });
  writeFileSync(join(dist, "journal", "index.html"), "<html><body>WEBLACK AFRICA</body></html>");
  const problems = checkPublicPages(dist);
  assert.ok(problems.some((p) => p.includes("/_astro/app.js") && p.includes("OAuth")));
  assert.ok(problems.some((p) => p.includes("/fuite.json") && p.includes("renouvellement")));
  assert.ok(problems.some((p) => p.includes("/journal/index.html") && p.includes("WEBLACK AFRICA")));
});
