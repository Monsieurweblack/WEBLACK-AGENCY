/**
 * Banc d'essai des modèles Workers AI pour MALYA (REST, comptes gratuits inclus).
 *   CF_ACCOUNT_ID=… CF_API_TOKEN=… node --experimental-strip-types scripts/malya-model-eval.mjs <modèle> [<modèle>…]
 * Consomme des Neurons de l'allocation quotidienne (10 000 / jour, plan gratuit) : à lancer avec parcimonie.
 * Les prompts sont ceux que MALYA construit réellement (functions/lib/malya/prompt.ts).
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { buildPrompt } = await imp("functions/lib/malya/prompt.ts");
const { retrieve, KNOWLEDGE } = await imp("functions/lib/malya/knowledge.ts");
const { limitsFor } = await imp("functions/lib/malya/budget.ts");

const { CF_ACCOUNT_ID: ACCOUNT, CF_API_TOKEN: TOKEN } = process.env;
if (!ACCOUNT || !TOKEN) { console.error("CF_ACCOUNT_ID et CF_API_TOKEN requis (variables d'environnement)."); process.exit(2); }
const models = process.argv.slice(2);
const NOW = new Date("2026-11-24T10:00:00Z");
const CASES = [
  { id: "fr-createur", lang: "fr", skill: "consulting", message: "Je suis créatrice de mode à Dakar et je veux développer ma marque à l'international. Par où commencer ?" },
  { id: "en-event", lang: "en", skill: "creative_brief", message: "We are organising a fashion show in Lagos next year. How should we think about partnerships and sponsorship?" },
  { id: "fr-sources", lang: "fr", skill: "sector_research", message: "Que fait la FHCM, et que dit le CNMI de la Milano Fashion Week ?" },
  { id: "fr-chiffres", lang: "fr", skill: "sector_research", message: "Combien pèse le marché de la mode africaine en 2025, et quel est le salaire moyen d'un mannequin ?" },
];
for (const model of models) {
  console.log(`\n######## ${model}`);
  for (const c of CASES) {
    const entries = retrieve(c.message, KNOWLEDGE, 4, NOW).map((r) => r.entry);
    const p = buildPrompt({ lang: c.lang, skill: c.skill, message: c.message, history: [], entries, outdatedIds: new Set(), limits: limitsFor("normal") });
    const body = { messages: [{ role: "system", content: p.system }, ...p.messages], max_tokens: 700 };
    const t0 = Date.now();
    let res;
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      res = await r.json();
    } catch (e) { console.log(`[${c.id}] ERREUR réseau ${e.name}`); continue; }
    const ms = Date.now() - t0;
    if (!res.success) { console.log(`[${c.id}] ÉCHEC ${JSON.stringify(res.errors).slice(0, 200)}`); continue; }
    const out = res.result?.response ?? res.result?.choices?.[0]?.message?.content ?? "";
    const u = res.result?.usage ?? {};
    console.log(`[${c.id}] ${ms} ms · tokens ${u.prompt_tokens ?? "?"}→${u.completion_tokens ?? "?"} · passages=${entries.length} · [S#]=${(out.match(/\[S\d+\]/g) ?? []).join("")}`);
    console.log("   " + String(out).replace(/\s+/g, " ").slice(0, 520));
  }
}
