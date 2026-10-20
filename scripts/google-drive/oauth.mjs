/**
 * Logique OAuth 2.0 « application de bureau » de scripts/google-drive/authorize.mjs,
 * isolée en fonctions pures ou à dépendances injectées pour être testée
 * (scripts/lib/googleDriveAuth.test.mjs) sans navigateur ni réseau.
 *
 * Flux (https://developers.google.com/identity/protocols/oauth2/native-app) :
 *   redirection de bouclage http://127.0.0.1:<port>/callback (serveur local
 *   temporaire, aucune route publique), PKCE S256, `state` aléatoire vérifié
 *   au retour, accès hors ligne pour obtenir un jeton de renouvellement.
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
export const SCOPES = ["openid", EMAIL_SCOPE, DRIVE_SCOPE];
export const SECRET_NAMES = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"];

export class OAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const base64url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Vérificateur PKCE, son défi S256, et un `state` anti-falsification — tous aléatoires. */
export function createPkce() {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()), state: base64url(randomBytes(24)) };
}

export function isDesktopClientId(clientId) {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId ?? "");
}

/**
 * Lit le fichier JSON téléchargé depuis Google Cloud (« Télécharger le JSON »
 * du client OAuth). Un client « Application de bureau » est sous la clé
 * `installed` ; un client « Application Web » (`web`) n'accepte pas la
 * redirection de bouclage : refusé avec une explication.
 */
export function readClientFile(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new OAuthError("client_file_unreadable", "Fichier client illisible : vérifiez le chemin du JSON téléchargé depuis Google Cloud.");
  }
  if (parsed.web) throw new OAuthError("client_type_web", "Ce client OAuth est de type « Application Web ». Il faut un client « Application de bureau » (étape 4 du guide).");
  const installed = parsed.installed;
  if (!installed?.client_id || !installed?.client_secret) throw new OAuthError("client_file_invalid", "Le fichier ne contient pas de client « Application de bureau » (clé « installed »).");
  return { clientId: String(installed.client_id).trim(), clientSecret: String(installed.client_secret).trim() };
}

export function buildAuthUrl({ clientId, redirectUri, state, challenge, loginHint }) {
  if (!isDesktopClientId(clientId)) throw new OAuthError("invalid_client_id", "ID client invalide.");
  if (!/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirectUri)) throw new OAuthError("invalid_redirect_uri", "Redirection attendue : bouclage http://127.0.0.1:<port>/callback.");
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

/**
 * Commande qui ouvre le navigateur SANS interpréteur de commandes. Avec
 * `cmd /c start`, le caractère `&` de l'URL est pris pour un séparateur de
 * commandes : l'adresse était tronquée après `client_id` et Google répondait
 * « Required parameter is missing: response_type ». rundll32 reçoit l'URL
 * comme un argument unique, intact.
 */
export function browserCommand(url, platform = process.platform) {
  if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

/** Contrôle du retour de Google sur le serveur local : refus, `state` falsifié, code absent. */
export function parseCallback(requestUrl, expectedState) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const error = url.searchParams.get("error");
  if (error) throw new OAuthError(`google_${/^[a-z_]{1,64}$/.test(error) ? error : "error"}`, error === "access_denied" ? "Autorisation refusée sur la page Google." : `Google a renvoyé une erreur : ${error}`);
  const state = url.searchParams.get("state");
  if (!state || state !== expectedState) throw new OAuthError("state_mismatch", "Paramètre « state » absent ou différent : retour rejeté (possible falsification).");
  const code = url.searchParams.get("code");
  if (!code) throw new OAuthError("missing_code", "Aucun code d'autorisation dans le retour de Google.");
  return { code };
}

/**
 * Échange du code, puis vérifications avant toute écriture de secret :
 * jeton de renouvellement présent, permission drive.file accordée, compte
 * attendu et vérifié, accès Drive réellement fonctionnel.
 * Retourne le jeton de renouvellement ; ne journalise jamais aucun jeton.
 */
export async function completeAuthorization({ fetchImpl = fetch, clientId, clientSecret, code, verifier, redirectUri, expectedAccount }) {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  let tokens = {};
  try {
    tokens = await response.json();
  } catch {
    // traité ci-dessous
  }
  if (!response.ok) {
    const reason = typeof tokens.error === "string" && /^[a-z_]{1,64}$/.test(tokens.error) ? tokens.error : `http_${response.status}`;
    const hints = {
      invalid_client: "ID client ou code secret incorrect.",
      invalid_grant: "Code expiré, déjà utilisé ou vérificateur PKCE différent : relancez le script.",
      redirect_uri_mismatch: "Le client n'est pas de type « Application de bureau ».",
    };
    throw new OAuthError(`token_${reason}`, `Échange du code refusé par Google (${reason}). ${hints[reason] ?? ""}`.trim());
  }
  if (!tokens.refresh_token) throw new OAuthError("no_refresh_token", "Google n'a pas fourni de jeton de renouvellement. Retirez l'accès sur https://myaccount.google.com/permissions puis relancez.");
  const granted = String(tokens.scope ?? "").split(" ");
  if (!granted.includes(DRIVE_SCOPE)) throw new OAuthError("scope_missing", "La permission Google Drive (drive.file) n'a pas été accordée. Relancez et cochez l'accès à Drive.");

  // Jeton d'identité reçu directement de Google en HTTPS : son contenu suffit à lire le compte.
  let identity = {};
  try {
    identity = JSON.parse(Buffer.from(String(tokens.id_token).split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new OAuthError("no_identity", "Identité du compte absente de la réponse Google (permission « email » manquante ?).");
  }
  if (String(identity.email ?? "").toLowerCase() !== expectedAccount.toLowerCase() || identity.email_verified !== true) {
    throw new OAuthError("wrong_account", `Compte autorisé inattendu. Connectez-vous avec ${expectedAccount} et relancez.`);
  }

  // Test réel, lecture seule : exactement l'appel que fera le serveur.
  const probe = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: "appProperties has { key='weblackPath' and value='root' } and trashed = false", fields: "files(id)", spaces: "drive" })}`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!probe.ok) throw new OAuthError("drive_probe_failed", `Accès Drive refusé (HTTP ${probe.status}). Vérifiez que l'API Google Drive est activée dans ce projet Google Cloud.`);

  return { refreshToken: tokens.refresh_token };
}

/** Écriture des secrets — jamais en --dry-run, et seulement avec les trois valeurs. */
export async function storeSecrets({ dryRun, putSecret, clientId, clientSecret, refreshToken }) {
  if (dryRun) return [];
  if (!clientId || !clientSecret || !refreshToken) throw new OAuthError("incomplete_secrets", "Secrets incomplets : rien n'est enregistré.");
  const values = [clientId, clientSecret, refreshToken];
  const stored = [];
  for (let i = 0; i < SECRET_NAMES.length; i++) {
    await putSecret(SECRET_NAMES[i], values[i]);
    stored.push(SECRET_NAMES[i]);
  }
  return stored;
}
