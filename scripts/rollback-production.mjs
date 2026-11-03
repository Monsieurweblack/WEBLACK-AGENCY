// Retour arrière de la production Cloudflare Pages (projet weblack), en une commande :
//
//   node scripts/rollback-production.mjs <tag-ou-commit> [--dry-run]
//
// Remet en ligne, sans rebuild, le dernier déploiement de PRODUCTION réussi
// construit depuis ce commit (API Cloudflare « rollback » : bascule
// instantanée vers des fichiers déjà construits). Puis vérifie que la
// production active est bien celle demandée et que https://weblack.fr/
// répond 200. --dry-run résout et vérifie tout sans rien basculer.
//
// Jeton : CLOUDFLARE_API_TOKEN, sinon le jeton OAuth local de wrangler
// (`npx wrangler whoami` le rafraîchit). Jamais affiché.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT = "weblack";
const SITE = "https://weblack.fr/";
const [ref, flag] = process.argv.slice(2);
const dryRun = flag === "--dry-run";
if (!ref) {
  console.error("usage : node scripts/rollback-production.mjs <tag-ou-commit> [--dry-run]");
  process.exit(2);
}

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    path.join(process.env.XDG_CONFIG_HOME ?? "", ".wrangler/config/default.toml"),
    path.join(os.homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml"),
    path.join(os.homedir(), ".config/.wrangler/config/default.toml"),
    path.join(os.homedir(), ".wrangler/config/default.toml"),
  ];
  for (const file of candidates) {
    try {
      const match = readFileSync(file, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {}
  }
  throw new Error("aucun jeton Cloudflare : définir CLOUDFLARE_API_TOKEN ou lancer `npx wrangler whoami`");
}

const headers = { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
async function api(url, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${url}`, { ...init, headers, signal: AbortSignal.timeout(30000) });
  const body = await res.json();
  if (!body.success) throw new Error(`API Cloudflare ${res.status} : ${JSON.stringify(body.errors)}`);
  return body.result;
}

const sha = execFileSync("git", ["rev-parse", `${ref}^{commit}`], { encoding: "utf8" }).trim();
const account = (await api("/accounts"))[0].id;
const base = `/accounts/${account}/pages/projects/${PROJECT}`;
const deployments = (await api(`${base}/deployments?env=production&per_page=25`)) ?? [];
const target = deployments.find(
  (d) => d.deployment_trigger?.metadata?.commit_hash === sha && d.latest_stage?.name === "deploy" && d.latest_stage?.status === "success",
);
if (!target) throw new Error(`aucun déploiement de production réussi pour ${ref} (${sha.slice(0, 7)}) parmi les 25 derniers`);
const active = (await api(base)).canonical_deployment;
console.log(`cible  : ${target.id} (${sha.slice(0, 7)}, ${target.created_on})`);
console.log(`active : ${active?.id} (${active?.deployment_trigger?.metadata?.commit_hash?.slice(0, 7)})`);

if (dryRun) {
  console.log("--dry-run : cible résolue et vérifiée, aucune bascule effectuée.");
  process.exit(0);
}

await api(`${base}/deployments/${target.id}/rollback`, { method: "POST" });
const now = (await api(base)).canonical_deployment;
const status = (await fetch(SITE, { signal: AbortSignal.timeout(30000) })).status;
const ok = now?.deployment_trigger?.metadata?.commit_hash === sha && status === 200;
console.log(`après  : production ${now?.id} (${now?.deployment_trigger?.metadata?.commit_hash?.slice(0, 7)}), ${SITE} → ${status}`);
console.log(ok ? "RETOUR ARRIÈRE OK" : "RETOUR ARRIÈRE À VÉRIFIER");
process.exit(ok ? 0 : 1);
