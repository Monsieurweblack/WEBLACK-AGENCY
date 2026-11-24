/**
 * Vérifie que chaque source du corpus MALYA (functions/lib/malya/corpus.ts) répond encore et
 * contient les éléments sur lesquels l'entrée s'appuie. Lecture seule, pages publiques uniquement.
 *   node --experimental-strip-types scripts/malya-sources-check.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { CORPUS } = await import(pathToFileURL(path.join(ROOT, "functions/lib/malya/corpus.ts")).href);

// Éléments textuels que la page doit toujours contenir pour que l'entrée reste fidèle.
const EXPECT = {
  "fhcm-role": ["Paris Fashion Week", "Haute Couture"],
  "fhcm-cnmi-protocole": ["CNMI"],
  "cnmi-milano-fashion-week": ["Milano Fashion Week", "invitation"],
  "ifm-grande-ecole": ["Grande", "Executive"],
  "ompi-la-haye-dessins": ["Hague", "100"],
  "unesco-convention-2005": ["2005", "Convention"],
  "safw-presentation": ["Ethical Fashion"],
};
let bad = 0;
for (const e of CORPUS) {
  const url = e.source.url;
  let status = 0, html = "";
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; WEBLACK-source-check)" }, signal: AbortSignal.timeout(20000) });
    status = r.status; html = await r.text();
  } catch (err) { status = -1; }
  const missing = (EXPECT[e.id] ?? []).filter((w) => !html.toLowerCase().includes(w.toLowerCase()));
  const ok = status === 200 && missing.length === 0;
  if (!ok) bad += 1;
  console.log(`${ok ? "OK  " : "REVOIR"} ${e.id} → HTTP ${status}${missing.length ? " · éléments absents : " + missing.join(", ") : ""}`);
}
console.log(bad ? `${bad} source(s) à revoir` : "toutes les sources répondent et contiennent les éléments attendus");
process.exit(bad ? 1 : 0);
