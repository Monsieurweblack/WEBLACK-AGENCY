/**
 * Test RÉEL de la passerelle Anthropic — dépense réelle (de l'ordre de 0,001 $ au total).
 *
 *   ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/malya-live-check.mjs --confirm-spend
 *
 * - refuse de s'exécuter sans --confirm-spend et sans clé dans l'environnement ;
 * - passe par le MÊME code que l'API (createLlm : réservation budgétaire atomique, SDK officiel) ;
 * - plafond de sécurité propre à ce test (0,05 € ≈ 0,045 $, base D1 en mémoire jetable) ;
 * - n'affiche jamais la clé ; ne touche ni Cloudflare, ni D1 distante, ni la production.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

if (!process.argv.includes("--confirm-spend")) { console.error("Refus : ce test dépense de l'argent réel. Ajoutez --confirm-spend pour confirmer."); process.exit(2); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("Refus : ANTHROPIC_API_KEY absente de l'environnement (jamais passée en argument)."); process.exit(2); }

const { handleTurn } = await imp("functions/lib/malya/orchestrator.ts");
const { createLlm } = await imp("functions/lib/malya/llm.ts");
const { snapshot, capMicro } = await imp("functions/lib/malya/budget.ts");
const { SqliteD1 } = await imp("functions/lib/testDoubles.ts");

const db = new SqliteD1();
const env = { MALYA_ENABLED: "true", ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, DB: db, MALYA_MODEL: process.env.MALYA_MODEL, MALYA_MONTHLY_BUDGET_EUR: "0.05" };
const llm = createLlm(env);
const cap = capMicro(0.05);
const plan = await llm.plan();
console.log("plan:", JSON.stringify({ ok: plan.ok, state: plan.state, reason: plan.reason, model: plan.model }));
if (!plan.ok) process.exit(1);

const cases = [
  { lang: "fr", message: "Quelles collaborations WEBLACK a-t-elle réellement menées, et que propose l'IFM comme formations ?" },
  { lang: "en", message: "What does the Hague System let a fashion designer do, and is Milano Fashion Week open to the public?" },
];
let failures = 0;
for (const c of cases) {
  const r = await handleTurn({ message: c.message, lang: c.lang }, { llm });
  const ok = r.mode === "ai" && r.reply.length > 40;
  if (!ok) failures += 1;
  console.log(`\n[${c.lang}] mode=${r.mode} vérification=${r.verification} citations=${r.citations.map((x) => x.ref + ":" + x.id).join(",") || "aucune"}${r.modeReason ? " raison=" + r.modeReason : ""}`);
  console.log(r.reply.slice(0, 700));
}
const s = await snapshot(db, new Date(), cap);
console.log(`\nbudget du test: appels=${s.calls} erreurs=${s.errors} tokens entrée=${s.inputTokens} sortie=${s.outputTokens} coût réel=${(s.settledMicro / 1e6).toFixed(6)} $ engagé=${(s.committedMicro / 1e6).toFixed(6)} $ plafond=${(cap / 1e6).toFixed(4)} $`);
if (s.committedMicro > cap) { console.error("ÉCHEC : plafond dépassé"); process.exit(1); }
console.log(failures ? `${failures} conversation(s) sans réponse du modèle` : "OK : réponses du modèle obtenues, coût mesuré, plafond respecté");
process.exit(failures ? 1 : 0);
