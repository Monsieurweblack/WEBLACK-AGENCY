/**
 * Autorise l'archivage Google Drive des candidatures WEBLACK TALENTS.
 * À lancer sur la machine du propriétaire, après avoir créé le client OAuth
 * « Application de bureau » (voir docs/google-drive.md) :
 *
 *   node scripts/google-drive/authorize.mjs --client-file "<chemin du JSON client>" --dry-run
 *   node scripts/google-drive/authorize.mjs --client-file "<chemin du JSON client>"
 *
 * Sans --client-file, l'ID client puis le code secret sont demandés (code
 * secret en saisie masquée) — jamais tapés dans une commande, donc jamais
 * conservés dans l'historique PowerShell. Les variables d'environnement
 * GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET restent acceptées.
 *
 * Déroulé (logique testée dans scripts/google-drive/oauth.mjs) :
 *  1. serveur local temporaire sur 127.0.0.1 (port libre), page de
 *     consentement Google : response_type=code, PKCE S256, state aléatoire ;
 *  2. retour vérifié (state, erreur Google, code présent), échange du code ;
 *  3. contrôles : jeton de renouvellement, permission drive.file, compte
 *     weblackconsulting@gmail.com vérifié, accès Drive réel (lecture seule) ;
 *  4. seulement alors, et jamais en --dry-run : écriture des trois secrets
 *     Cloudflare Pages (projet weblack) via wrangler, par l'entrée standard.
 *     Aucun secret ni jeton n'est affiché, journalisé ou écrit sur le disque.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  OAuthError,
  browserCommand,
  buildAuthUrl,
  completeAuthorization,
  createPkce,
  isDesktopClientId,
  readClientFile,
  storeSecrets,
  waitForAuthorizationCode,
} from "./oauth.mjs";

const EXPECTED_ACCOUNT = "weblackconsulting@gmail.com";
const PROJECT = "weblack";
const TIMEOUT_MS = 5 * 60 * 1000;
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const clientFileIndex = argv.indexOf("--client-file");
const clientFile = clientFileIndex >= 0 ? argv[clientFileIndex + 1] : undefined;

/** Erreur attendue (message déjà rédigé pour l'utilisateur, sans secret). */
class Stop extends Error {}

/** Question dans le terminal ; `hidden` : rien n'est affiché pendant la frappe ou le collage. */
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.startsWith(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    // shell requis sous Windows pour lancer npx ; les arguments sont fixes, la valeur passe par l'entrée standard.
    const child = spawn("npx", ["wrangler", "pages", "secret", "put", name, "--project-name", PROJECT], {
      shell: process.platform === "win32",
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("close", (status) =>
      status === 0
        ? resolve()
        : reject(new Stop(`${name} : wrangler a échoué (${errors.split("\n").find((l) => /ERROR/.test(l))?.trim() ?? `code ${status}`}). Vérifiez que wrangler est connecté (npx wrangler whoami), puis relancez.`)),
    );
    child.stdin.end(value);
  });
}

async function main() {
  // --- Identifiants du client OAuth ------------------------------------------------
  let clientId;
  let clientSecret;
  if (clientFile) ({ clientId, clientSecret } = readClientFile(clientFile));
  clientId ??= process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  clientSecret ??= process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if ((!clientId || !clientSecret) && !process.stdin.isTTY) {
    throw new Stop('Lancez le script dans un terminal interactif, ou indiquez --client-file "<chemin du JSON client>".');
  }
  if (!clientId) clientId = await ask("ID client OAuth (…apps.googleusercontent.com) : ");
  if (!clientSecret) clientSecret = await ask("Code secret du client (saisie masquée, collez puis Entrée) : ", true);
  if (!isDesktopClientId(clientId)) throw new Stop("L'ID client ne ressemble pas à un ID Google (il doit se terminer par .apps.googleusercontent.com). Vérifiez l'étape 4 du guide.");
  if (!clientSecret || clientSecret.length < 10) throw new Stop("Code secret vide ou incomplet. Copiez-le depuis la fiche du client OAuth (étape 4 du guide).");

  // --- Consentement Google via redirection de bouclage -----------------------------
  const { verifier, challenge, state } = createPkce();
  const { promise } = waitForAuthorizationCode({
    state,
    timeoutMs: TIMEOUT_MS,
    onListening: (redirectUri) => {
      const authUrl = buildAuthUrl({ clientId, redirectUri, state, challenge, loginHint: EXPECTED_ACCOUNT });
      console.log(`\nLe navigateur va s'ouvrir. Connectez-vous avec ${EXPECTED_ACCOUNT} et COCHEZ l'accès à Google Drive.`);
      console.log(`S'il ne s'ouvre pas, copiez cette adresse COMPLÈTE dans le navigateur :\n\n${authUrl}\n`);
      const { command, args } = browserCommand(authUrl);
      // Pas de shell : l'URL et ses « & » arrivent intacts au navigateur.
      spawn(command, args, { stdio: "ignore", detached: true, shell: false }).on("error", () => undefined).unref();
    },
  });
  const callback = await promise;

  // --- Échange, vérifications, puis seulement écriture des secrets -----------------
  const { refreshToken } = await completeAuthorization({
    clientId,
    clientSecret,
    code: callback.code,
    verifier,
    redirectUri: callback.redirectUri,
    expectedAccount: EXPECTED_ACCOUNT,
  });
  console.log(`✔ Compte vérifié : ${EXPECTED_ACCOUNT}. Permission : drive.file. Jeton de renouvellement obtenu. Accès Drive testé : OK.`);

  if (dryRun) {
    console.log("--dry-run : aucun secret enregistré dans Cloudflare. Relancez sans --dry-run pour les enregistrer.");
    return;
  }
  const stored = await storeSecrets({ dryRun, putSecret, clientId, clientSecret, refreshToken });
  for (const name of stored) console.log(`✔ Secret Cloudflare enregistré : ${name}`);
  console.log("\nTerminé. Prévenez Claude : il vérifiera les secrets et redéploiera le site (étape 6 du guide).");
}

// Jamais process.exit() : sous Windows, quitter de force pendant que des
// connexions réseau ou le serveur local se ferment déclenche l'assertion
// libuv « UV_HANDLE_CLOSING ». Le code de sortie est posé, le processus se
// termine de lui-même une fois tout fermé.
main().catch((error) => {
  const known = error instanceof OAuthError || error instanceof Stop;
  // Message rédigé, sans code OAuth, jeton ni secret ; l'erreur brute n'est jamais affichée.
  console.error(`\n✖ ${known ? error.message : "Erreur inattendue pendant l'autorisation (réseau ?). Relancez le script."}`);
  process.exitCode = 1;
});
