/**
 * Autorise l'archivage Google Drive des candidatures WEBLACK TALENTS.
 * À lancer UNE fois, sur la machine du propriétaire, après avoir créé le
 * client OAuth (voir docs/google-drive.md) :
 *
 *     node scripts/google-drive/authorize.mjs --dry-run   (test, rien n'est enregistré)
 *     node scripts/google-drive/authorize.mjs             (enregistre les secrets)
 *
 * L'ID client et le code secret sont DEMANDÉS par le script (le code secret
 * en saisie masquée) : jamais tapés dans une commande, donc jamais conservés
 * dans l'historique PowerShell. Les variables d'environnement
 * GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET restent acceptées.
 *
 * Ce que fait le script :
 *  1. ouvre la page de consentement Google (flux « application de bureau »,
 *     redirection locale 127.0.0.1, PKCE, état anti-falsification) ;
 *  2. vérifie que le compte autorisé est bien weblackconsulting@gmail.com et
 *     que la permission drive.file (fichiers créés par l'application
 *     uniquement) a été accordée, avec un jeton de renouvellement ;
 *  3. teste réellement l'accès à Drive (lecture seule, rien n'est créé) ;
 *  4. enregistre les trois secrets dans Cloudflare Pages (projet weblack)
 *     via wrangler, en les passant par l'entrée standard : ils ne sont ni
 *     affichés, ni écrits sur le disque, ni versionnés.
 *
 * Option --dry-run : tout sauf l'étape 4.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const EXPECTED_ACCOUNT = "weblackconsulting@gmail.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = ["openid", "email", DRIVE_SCOPE];
const PROJECT = "weblack";
const dryRun = process.argv.includes("--dry-run");

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

let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
if ((!clientId || !clientSecret) && !process.stdin.isTTY) {
  console.error("Lancez le script dans un terminal interactif (il vous demandera l'ID client et le code secret).");
  process.exit(1);
}
if (!clientId) clientId = await ask("ID client OAuth (…apps.googleusercontent.com) : ");
if (!clientSecret) clientSecret = await ask("Code secret du client (saisie masquée, collez puis Entrée) : ", true);
if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  console.error("L'ID client ne ressemble pas à un ID Google (il doit se terminer par .apps.googleusercontent.com). Vérifiez l'étape 4 du guide.");
  process.exit(1);
}
if (clientSecret.length < 10) {
  console.error("Code secret vide ou incomplet. Copiez-le depuis la fiche du client OAuth (étape 4 du guide).");
  process.exit(1);
}

const base64url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = base64url(randomBytes(48));
const challenge = base64url(createHash("sha256").update(verifier).digest());
const state = base64url(randomBytes(24));

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ok ? "<p>Autorisation reçue. Vous pouvez fermer cet onglet et revenir au terminal.</p>" : "<p>Autorisation refusée ou invalide.</p>");
    server.close();
    if (ok) resolve({ code: url.searchParams.get("code"), redirectUri: `http://127.0.0.1:${server.address()?.port ?? port}/callback` });
    else reject(new Error(`Autorisation refusée : ${url.searchParams.get("error") ?? "état invalide"}`));
  });
  let port;
  server.listen(0, "127.0.0.1", () => {
    port = server.address().port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      login_hint: EXPECTED_ACCOUNT,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    console.log(`\nOuvrez cette adresse et connectez-vous avec ${EXPECTED_ACCOUNT} :\n\n${auth}\n`);
    const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", auth.toString()]] : [process.platform === "darwin" ? "open" : "xdg-open", [auth.toString()]];
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  });
  setTimeout(() => {
    server.close();
    reject(new Error("Délai dépassé (5 minutes) sans autorisation."));
  }, 5 * 60 * 1000).unref();
});

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: code.code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: code.redirectUri,
  }),
});
const tokens = await tokenResponse.json();
if (!tokenResponse.ok) {
  console.error(`Échange du code refusé par Google : ${tokens.error ?? tokenResponse.status}`);
  process.exit(1);
}
if (!tokens.refresh_token) {
  console.error("Google n'a pas fourni de jeton de renouvellement. Retirez l'accès de l'application sur https://myaccount.google.com/permissions puis relancez.");
  process.exit(1);
}
if (!String(tokens.scope ?? "").split(" ").includes(DRIVE_SCOPE)) {
  console.error("La permission Google Drive (drive.file) n'a pas été accordée. Relancez et cochez l'accès à Drive.");
  process.exit(1);
}
// Jeton d'identité reçu directement de Google, en HTTPS : son contenu suffit à lire l'adresse du compte.
const identity = JSON.parse(Buffer.from(String(tokens.id_token).split(".")[1], "base64url").toString("utf8"));
if (String(identity.email).toLowerCase() !== EXPECTED_ACCOUNT || identity.email_verified !== true) {
  console.error(`Compte autorisé inattendu. Connectez-vous avec ${EXPECTED_ACCOUNT} et relancez.`);
  process.exit(1);
}

// Test réel, en lecture seule : le serveur fera exactement cet appel.
const probe = await fetch(
  `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: "appProperties has { key='weblackPath' and value='root' } and trashed = false", fields: "files(id)", spaces: "drive" })}`,
  { headers: { Authorization: `Bearer ${tokens.access_token}` } },
);
if (!probe.ok) {
  console.error(`Accès Drive refusé (HTTP ${probe.status}). Vérifiez que l'API Google Drive est activée dans le projet Google Cloud.`);
  process.exit(1);
}
console.log(`Compte vérifié : ${EXPECTED_ACCOUNT}. Permission : drive.file. Accès Drive testé : OK.`);

if (dryRun) {
  console.log("--dry-run : aucun secret enregistré.");
  process.exit(0);
}

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "pages", "secret", "put", name, "--project-name", PROJECT], { shell: process.platform === "win32", stdio: ["pipe", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("close", (status) => (status === 0 ? resolve() : reject(new Error(`${name} : wrangler a échoué (${errors.split("\n").find((l) => /ERROR/.test(l)) ?? status})`))));
    child.stdin.end(value);
  });
}

for (const [name, value] of [
  ["GOOGLE_OAUTH_CLIENT_ID", clientId],
  ["GOOGLE_OAUTH_CLIENT_SECRET", clientSecret],
  ["GOOGLE_DRIVE_REFRESH_TOKEN", tokens.refresh_token],
]) {
  await putSecret(name, value);
  console.log(`Secret Cloudflare enregistré : ${name}`);
}
console.log("\nTerminé. Les secrets s'appliquent au prochain déploiement : poussez un commit sur main (ou relancez le dernier déploiement), puis utilisez « Tester la connexion Drive » dans /admin/candidatures/.");
