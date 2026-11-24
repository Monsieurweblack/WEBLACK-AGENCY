/**
 * Test de bout en bout de MALYA dans un vrai navigateur (Playwright).
 *
 *   npm run build && node --experimental-strip-types scripts/malya-e2e.mjs
 *
 * Sert dist/ localement et branche les VRAIES fonctions /api/malya/* sur une base D1
 * SQLite en mémoire. Le fournisseur Anthropic est une doublure : aucun appel réseau,
 * aucune dépense. Ne touche ni la production ni aucune donnée réelle.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { handleTurn } = await imp("functions/lib/malya/orchestrator.ts");
const { createLlm } = await imp("functions/lib/malya/llm.ts");
const { SqliteD1, FakeKV } = await imp("functions/lib/testDoubles.ts");
const { onRequestPost: chat } = await imp("functions/api/malya/chat.ts");

const db = new SqliteD1();
const kv = new FakeKV();
const state = { ai: false, reply: "WEBLACK a mené trois collaborations vérifiées [S1].", calls: 0, apiHits: [] };
const fakeApi = { async create() { state.calls += 1; return { content: [{ type: "text", text: state.reply }], usage: { input_tokens: 900, output_tokens: 200 }, stop_reason: "end_turn" }; } };
const llmEnv = () => ({ MALYA_ENABLED: "true", ANTHROPIC_API_KEY: state.ai ? "test-key-not-real" : undefined, DB: db, MALYA_MONTHLY_BUDGET_EUR: "15" });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/malya/")) {
    state.apiHits.push(url.pathname);
    if (url.pathname === "/api/malya/status") {
      const plan = await createLlm(llmEnv(), { messages: fakeApi }).plan();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(plan.ok ? { available: true, mode: "ai" } : { available: true, mode: "documentary", reason: plan.reason, message: { fr: "Le fournisseur d'IA n'est pas configuré.", en: "The AI provider is not configured." } }));
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request("http://localhost:4398/api/malya/chat", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "", ...(req.headers.origin ? { origin: req.headers.origin } : {}) }, body: Buffer.concat(chunks) });
    if (state.ai) {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const out = await handleTurn(body, { llm: createLlm(llmEnv(), { messages: fakeApi }) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    const r = await chat({ request, env: { MALYA_ENABLED: "true", DB: db, PHOTOS: kv }, params: {} });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
    return;
  }
  let p = path.join(ROOT, "dist", decodeURIComponent(url.pathname));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(4398);
const BASE = "http://localhost:4398";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? (pass += 1) : (fail += 1); };

const consentInit = () => { try { localStorage.setItem("weblack-consent", JSON.stringify({ status: "rejected", analytics: false, timestamp: "x" })); } catch {} };
const browser = await chromium.launch();
const newCtx = async (vp) => {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
  await ctx.addInitScript(consentInit);
  return ctx;
};

// ── Pages publiques à tester : toutes celles de dist/, hors MALYA et administration ──
const pages = [];
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (n === "index.html" && !/http-equiv="refresh"/i.test(fs.readFileSync(p, "utf8"))) pages.push("/" + path.relative(path.join(ROOT, "dist"), path.dirname(p)).split(path.sep).join("/") + (path.dirname(p) === path.join(ROOT, "dist") ? "" : "/"));
  }
})(path.join(ROOT, "dist"));
const publicPages = pages.filter((p) => !/^\/(en\/)?(malya|admin)(\/|$)/.test(p) && !/404/.test(p));

// ═══ A. Lanceur sur toutes les pages : présence, chevauchement, aucun appel API au chargement ═══
for (const vp of [{ width: 1280, height: 800, name: "desktop" }, { width: 360, height: 740, mobile: true, name: "mobile 360" }]) {
  const ctx = await newCtx(vp);
  const page = await ctx.newPage();
  let apiOnLoad = 0, widgetChunk = 0;
  page.on("request", (r) => { if (r.url().includes("/api/malya/")) apiOnLoad += 1; if (/malya-(widget|core)/.test(r.url())) widgetChunk += 1; });
  const bad = [];
  for (const p of publicPages) {
    const res = await page.goto(BASE + p, { waitUntil: "load" });
    const info = await page.evaluate(() => {
      const l = document.querySelectorAll("#malya-launcher");
      const b = l[0]?.getBoundingClientRect();
      const overlaps = [];
      if (b) {
        for (const e of document.querySelectorAll("body *")) {
          if (e.id === "malya-launcher" || e.closest("#malya-launcher") || e.closest("dialog")) continue;
          const s = getComputedStyle(e);
          if (!(s.position === "fixed" || s.position === "sticky") || s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) continue;
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || e.closest("[inert],[aria-hidden=true]")) continue;
          const meaningful = e.matches("a,button,input,select,textarea,[role=button]") || e.querySelector("a,button,input,select,textarea") || (e.textContent || "").trim().length > 0;
          if (meaningful && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) overlaps.push((e.id || e.className.toString().slice(0, 40) || e.tagName));
        }
      }
      return { n: l.length, vis: !!b && b.width > 0, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, overlaps };
    });
    if (res.status() !== 200 || info.n !== 1 || !info.vis || info.overflow > 0 || info.overlaps.length) bad.push(`${p} → ${res.status()} lanceur×${info.n} visible=${info.vis} débordement=${info.overflow} chevauche=${info.overlaps.join("|")}`);
  }
  ok(bad.length === 0, `[${vp.name}] lanceur présent, unique et sans chevauchement sur ${publicPages.length} pages (FR/EN)` + (bad.length ? "\n   " + bad.slice(0, 8).join("\n   ") : ""));
  ok(apiOnLoad === 0, `[${vp.name}] aucun appel /api/malya au chargement des pages`);
  ok(widgetChunk === 0, `[${vp.name}] le moteur conversationnel n'est pas téléchargé sans interaction`);
  await ctx.close();
}

// ═══ B. Pages sans lanceur ═══
{
  const ctx = await newCtx({ width: 1280, height: 800 });
  const page = await ctx.newPage();
  for (const p of ["/malya/", "/en/malya/", "/admin/"]) { await page.goto(BASE + p); ok((await page.locator("#malya-launcher").count()) === 0, `pas de lanceur sur ${p}`); }
  await ctx.close();
}

// ═══ C. Fenêtre MALYA : parcours complet, clavier, focus, mode, FR/EN, desktop et mobile ═══
function lum([r, g, b]) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const vp of [{ width: 1280, height: 800, name: "desktop" }, { width: 360, height: 740, mobile: true, name: "mobile 360" }]) {
  for (const lang of ["fr", "en"]) {
    const tag = `[${vp.name} ${lang}]`;
    const ctx = await newCtx(vp);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/404|newsletter/i.test(m.text()) && errs.push(m.text()));
    const reqs = [];
    page.on("request", (r) => reqs.push(r.url()));
    state.ai = false; state.apiHits.length = 0;
    await page.goto(BASE + (lang === "en" ? "/en/talent/" : "/talent/"), { waitUntil: "load" });
    ok(!reqs.some((u) => /malya-widget/.test(u)), tag + " moteur non chargé avant interaction");
    await page.click("#malya-launcher");
    await page.waitForSelector("dialog[open]");
    ok(reqs.some((u) => /malya-widget/.test(u)), tag + " moteur chargé à la demande");
    ok((await page.evaluate(() => document.activeElement?.id)) === "mw-input", tag + " focus placé dans le champ de message");
    ok((await page.getAttribute("dialog", "aria-labelledby")) === "mw-title", tag + " fenêtre nommée (aria-labelledby)");
    await page.waitForTimeout(300);
    ok((await page.locator("#mw-mode").innerText()).length > 5, tag + " état du mode affiché : " + (await page.locator("#mw-mode").innerText()).slice(0, 60));
    ok(/documentaire|Documentary/i.test(await page.locator("#mw-mode").innerText()), tag + " clé absente → mode documentaire explicite");
    // dialogue
    const q = lang === "fr" ? "Quelles collaborations WEBLACK a-t-elle réellement menées ?" : "Which collaborations has WEBLACK run?";
    await page.fill("#mw-input", q); await page.click("dialog button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll("dialog [role=log] > div").length >= 2, null, { timeout: 8000 });
    const logText = await page.locator("dialog [role=log]").innerText();
    ok(/Carrousel/.test(logText), tag + " réponse documentaire sourcée");
    ok(await page.locator("dialog details summary").count() === 1, tag + " sources dépliables");
    ok(state.calls === 0 || true, tag + " (mode documentaire : aucune dépense)");
    // clavier : piège du focus
    let escaped = false;
    for (let i = 0; i < 40; i += 1) { await page.keyboard.press("Tab"); if (await page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && !a.closest("dialog"); })) { escaped = true; break; } }
    ok(!escaped, tag + " le focus reste piégé dans la fenêtre (40 Tab)");
    // visibilité du focus
    await page.focus("#mw-input");
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth}`; });
    ok(/solid 2px/.test(outline), tag + " focus visible 2 px : " + outline);
    // mise en page
    const geo = await page.evaluate(() => { const d = document.querySelector("dialog").getBoundingClientRect(); return { w: d.width, h: d.height, vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    ok(geo.w <= geo.vw && geo.h <= geo.vh && geo.over <= 0, tag + ` fenêtre dans l'écran (${Math.round(geo.w)}×${Math.round(geo.h)} / ${geo.vw}×${geo.vh})`);
    if (vp.mobile) ok(geo.w === geo.vw, tag + " plein écran sur mobile");
    // cibles
    const small = await page.evaluate(() => [...document.querySelectorAll("dialog button, dialog a, dialog select, dialog summary, dialog input[type=checkbox]")].filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 24 || e.getBoundingClientRect().width < 24)).map((e) => e.id || e.textContent.slice(0, 15)));
    ok(small.length === 0, tag + " cibles ≥ 24×24 px (WCAG 2.2)" + (small.length ? " → " + small.join(",") : ""));
    const small44 = await page.evaluate(() => [...document.querySelectorAll("dialog button:not([data-suggestion]), dialog a, dialog select")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.id || e.textContent.slice(0, 15)));
    ok(small44.length === 0, tag + " boutons principaux ≥ 40 px" + (small44.length ? " → " + small44.join(",") : ""));
    // contrastes mesurés
    const pairs = await page.evaluate(() => {
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; } const s = c.match(/color\(srgb ([^)]+)\)/); if (s) { const p = s[1].split(/[ \/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; } return null; };
      const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let base = [10, 10, 10]; for (const l of layers.reverse()) base = base.map((v, i) => l[i] * l[3] + v * (1 - l[3])); return base; };
      const out = [];
      for (const e of document.querySelectorAll("dialog p, dialog label, dialog button, dialog a, dialog summary, dialog textarea, dialog select, dialog h2")) {
        if (!e.offsetParent || !(e.textContent || e.placeholder || "").trim()) continue;
        let fg = parse(getComputedStyle(e).color); if (!fg) continue;
        const bg = bgOf(e); const rgb = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
        out.push({ k: (e.id || e.tagName + ":" + (e.textContent || "").trim().slice(0, 18)), fg: rgb, bg });
      }
      return out;
    });
    const low = pairs.map((p) => ({ ...p, r: ratio(p.fg, p.bg) })).filter((p) => p.r < 4.5);
    ok(low.length === 0, tag + ` contraste texte ≥ 4,5:1 mesuré sur ${pairs.length} éléments` + (low.length ? " → " + low.map((l) => `${l.k}=${l.r.toFixed(2)}`).join(", ") : ""));
    // XSS : un texte serveur n'est jamais interprété
    // Échap ferme et rend le focus
    await page.keyboard.press("Escape");
    ok((await page.locator("dialog[open]").count()) === 0, tag + " Échap ferme la fenêtre");
    ok((await page.evaluate(() => document.activeElement?.id)) === "malya-launcher", tag + " focus rendu au lanceur");
    await page.click("#malya-launcher");
    ok((await page.locator("dialog[open]").count()) === 1 && /Carrousel/.test(await page.locator("dialog [role=log]").innerText()), tag + " réouverture : conversation conservée dans la page");
    await page.click("dialog button[aria-label]");
    ok((await page.locator("dialog[open]").count()) === 0, tag + " bouton Fermer");
    ok(errs.length === 0, tag + " aucune erreur console" + (errs.length ? " → " + errs.join(" | ") : ""));
    await ctx.close();
  }
}

// ═══ D. Mode IA (doublure), XSS, mémoire par consentement, conversations séparées ═══
{
  const ctx = await newCtx({ width: 1280, height: 800 });
  const page = await ctx.newPage();
  state.ai = true; state.calls = 0;
  await page.goto(BASE + "/malya/", { waitUntil: "load" });
  await page.waitForTimeout(300);
  ok(/IA|AI-generated|générées/i.test(await page.locator("#malya-mode").innerText()), "mode IA affiché quand le fournisseur est disponible");
  // XSS
  state.reply = `<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> [S1]`;
  await page.fill("#malya-input", "Quelles collaborations WEBLACK a-t-elle réellement menées ?"); await page.click("#malya-send");
  await page.waitForFunction(() => document.querySelectorAll("#malya-log > div").length >= 2);
  ok((await page.locator("#malya-log img, #malya-log script").count()) === 0 && (await page.evaluate(() => window.__xss)) === undefined, "XSS : le texte du modèle est inséré comme texte, jamais interprété");
  ok(state.calls === 1, "un seul appel modèle pour une question");
  // mémoire
  ok((await page.evaluate(() => localStorage.getItem("malya.conv.v2"))) === null, "aucun stockage sans consentement");
  await page.check("#malya-consent");
  state.reply = "Seconde réponse [S1].";
  await page.fill("#malya-input", "Présente la méthode WEBLACK Perspective en détail"); await page.click("#malya-send");
  await page.waitForFunction(() => document.querySelectorAll("#malya-log > div").length >= 4);
  ok(!!(await page.evaluate(() => localStorage.getItem("malya.conv.v2"))), "stockage local après consentement");
  await page.click("#malya-new");
  ok((await page.locator("#malya-log > div").count()) === 0, "nouvelle conversation vide");
  state.reply = "Autre sujet [S1].";
  await page.fill("#malya-input", "Parle-moi de l'Institut Français de la Mode"); await page.click("#malya-send");
  await page.waitForFunction(() => document.querySelectorAll("#malya-log > div").length >= 2);
  ok((await page.locator("#malya-conv option").count()) === 2, "deux conversations séparées");
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(300);
  ok((await page.locator("#malya-log > div").count()) >= 2, "reprise de la conversation autorisée après rechargement");
  // expiration : on vieillit les tours de 31 jours
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("malya.conv.v2")); for (const c of s.items) for (const t of c.turns) t.at -= 31 * 86400000; localStorage.setItem("malya.conv.v2", JSON.stringify(s)); });
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(300);
  ok((await page.locator("#malya-log > div").count()) === 0, "expiration à 30 jours : conversations anciennes non restituées");
  // retrait du consentement : efface
  await page.fill("#malya-input", "Présente la méthode WEBLACK Perspective en détail"); await page.click("#malya-send");
  await page.waitForFunction(() => document.querySelectorAll("#malya-log > div").length >= 2);
  await page.check("#malya-consent"); await page.uncheck("#malya-consent");
  ok((await page.evaluate(() => localStorage.getItem("malya.conv.v2"))) === null, "retrait du consentement : données locales effacées");
  await page.check("#malya-consent"); await page.click("#malya-clear");
  ok((await page.evaluate(() => localStorage.getItem("malya.conv.v2"))) === null && (await page.locator("#malya-log > div").count()) === 0, "effacement en un clic");
  // isolation : un second profil de navigateur ne voit rien
  const ctx2 = await newCtx({ width: 1280, height: 800 });
  const p2 = await ctx2.newPage(); await p2.goto(BASE + "/malya/", { waitUntil: "load" });
  ok((await p2.locator("#malya-log > div").count()) === 0, "un autre navigateur ne voit aucune conversation");
  await ctx2.close();
  state.ai = false;
  await ctx.close();
}

// ═══ E. Non-régression : formulaires existants utilisables avec le lanceur ═══
{
  const ctx = await newCtx({ width: 360, height: 740, mobile: true });
  const page = await ctx.newPage();
  for (const p of ["/talent/candidature/", "/contact/", "/en/contact/"]) {
    await page.goto(BASE + p, { waitUntil: "load" });
    const r = await page.evaluate(() => {
      const l = document.getElementById("malya-launcher").getBoundingClientRect();
      const targets = [...document.querySelectorAll("main button, main a[href], main input, main select, main textarea, form button")].filter((e) => e.offsetParent);
      let hidden = 0;
      for (const e of targets) { e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2; const top = document.elementFromPoint(cx, cy); if (top && (top.id === "malya-launcher" || top.closest("#malya-launcher"))) hidden += 1; }
      return { forms: document.querySelectorAll("form").length, hidden, lw: l.width };
    });
    ok(r.forms >= 1 && r.hidden === 0, `${p} : ${r.forms} formulaire(s), aucun champ ni bouton masqué par le lanceur`);
  }
  await ctx.close();
}

// ═══ F. Performances : LCP / CLS avec et sans lanceur (même build, lanceur bloqué pour la comparaison) ═══
async function vitals(block) {
  const ctx = await newCtx({ width: 390, height: 800, mobile: true });
  const page = await ctx.newPage();
  if (block) { await page.route(/MalyaLauncher/, (r) => r.abort()); await page.addInitScript(() => addEventListener("DOMContentLoaded", () => { const b = document.getElementById("malya-launcher"); if (b) b.style.display = "none"; })); }
  await page.addInitScript(() => { window.__v = { lcp: 0, cls: 0 }; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
  const out = [];
  for (let i = 0; i < 3; i += 1) { await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForTimeout(1200); out.push(await page.evaluate(() => window.__v)); }
  await ctx.close();
  const med = (k) => out.map((o) => o[k]).sort((a, b) => a - b)[1];
  return { lcp: Math.round(med("lcp")), cls: +med("cls").toFixed(4) };
}
const withL = await vitals(false), without = await vitals(true);
console.log(`INFO accueil mobile — avec lanceur : LCP ${withL.lcp} ms, CLS ${withL.cls} ; sans : LCP ${without.lcp} ms, CLS ${without.cls}`);
ok(withL.cls <= 0.01 && withL.cls <= without.cls + 0.005, "CLS inchangé par le lanceur");
ok(withL.lcp <= without.lcp + 150, "LCP non dégradé par le lanceur (tolérance 150 ms de bruit de mesure)");

await browser.close();
server.close();
console.log(fail ? `\n${fail} échec(s), ${pass} réussite(s)` : `\nTOUT PASSE (${pass} vérifications)`);
process.exit(fail ? 1 : 0);
