/**
 * Flux OAuth « application de bureau » de scripts/google-drive/authorize.mjs —
 * sans navigateur ni réseau : fetch simulé, aucun vrai jeton.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DRIVE_SCOPE,
  EMAIL_SCOPE,
  OAuthError,
  SECRET_NAMES,
  browserCommand,
  buildAuthUrl,
  completeAuthorization,
  createPkce,
  parseCallback,
  parseGrantedScopes,
  readClientFile,
  storeSecrets,
  waitForAuthorizationCode,
} from "../google-drive/oauth.mjs";

const CLIENT_ID = "123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com";
const REDIRECT = "http://127.0.0.1:53682/callback";

test("URL d'autorisation : tous les paramètres obligatoires, dont response_type=code", () => {
  const { state, challenge } = createPkce();
  const url = new URL(buildAuthUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, state, challenge, loginHint: "weblackconsulting@gmail.com" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const p = url.searchParams;
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("client_id"), CLIENT_ID);
  assert.equal(p.get("redirect_uri"), REDIRECT);
  assert.deepEqual(p.get("scope").split(" ").sort(), [DRIVE_SCOPE, EMAIL_SCOPE, "openid"].sort());
  assert.equal(p.get("state"), state);
  assert.equal(p.get("code_challenge"), challenge);
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.equal(p.get("access_type"), "offline", "nécessaire pour obtenir un jeton de renouvellement");
  assert.equal(p.get("prompt"), "consent");
  assert.ok(!url.toString().includes("client_secret"), "le code secret n'apparaît jamais dans l'URL");
});

test("URL d'autorisation : redirection de bouclage locale uniquement, ID client vérifié", () => {
  const { state, challenge } = createPkce();
  assert.throws(() => buildAuthUrl({ clientId: CLIENT_ID, redirectUri: "https://weblack.fr/api/admin/google-drive/callback", state, challenge }), { code: "invalid_redirect_uri" });
  assert.throws(() => buildAuthUrl({ clientId: "pas-un-id", redirectUri: REDIRECT, state, challenge }), { code: "invalid_client_id" });
});

test("PKCE et state : aléatoires, défi = SHA-256 du vérificateur", async () => {
  const a = createPkce();
  const b = createPkce();
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  const { createHash } = await import("node:crypto");
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
});

test("ouverture du navigateur sous Windows : pas de cmd.exe, l'URL arrive entière (cause de l'erreur response_type)", () => {
  const { state, challenge } = createPkce();
  const url = buildAuthUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, state, challenge });
  const { command, args } = browserCommand(url, "win32");
  assert.notEqual(command.toLowerCase(), "cmd");
  assert.ok(!/cmd|powershell/i.test(command));
  assert.equal(args[args.length - 1], url, "URL transmise en un seul argument, avec tous ses &");
  assert.ok(args[args.length - 1].includes("&response_type=code") || args[args.length - 1].includes("?response_type=code"));
  for (const platform of ["darwin", "linux"]) assert.equal(browserCommand(url, platform).args.at(-1), url);
});

test("retour Google : state falsifié, refus, code absent, cas nominal", () => {
  const state = "etat-attendu-1234567890";
  assert.throws(() => parseCallback(`/callback?code=abc&state=autre`, state), { code: "state_mismatch" });
  assert.throws(() => parseCallback(`/callback?code=abc`, state), { code: "state_mismatch" });
  assert.throws(() => parseCallback(`/callback?error=access_denied&state=${state}`, state), { code: "google_access_denied" });
  assert.throws(() => parseCallback(`/callback?state=${state}`, state), { code: "missing_code" });
  assert.deepEqual(parseCallback(`/callback?code=4%2F0Abc&state=${state}`, state), { code: "4/0Abc" });
});

// --- Échange du code et vérifications --------------------------------------------

const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

/** `tokeninfo` : réponse de l'endpoint tokeninfo — objet, "fail" (HTTP 400) ou "down" (réseau). */
function fakeGoogle({ token = {}, tokenStatus = 200, probeStatus = 200, tokeninfo = { scope: `openid ${EMAIL_SCOPE} ${DRIVE_SCOPE}` } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined, headers: init?.headers });
    if (String(url) === "https://oauth2.googleapis.com/tokeninfo") {
      if (tokeninfo === "down") throw new TypeError("fetch failed");
      if (tokeninfo === "fail") return new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 });
      return new Response(JSON.stringify(tokeninfo));
    }
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return new Response(
        JSON.stringify({
          access_token: "ya29.test",
          refresh_token: "1//test-refresh",
          scope: `openid ${EMAIL_SCOPE} ${DRIVE_SCOPE}`,
          id_token: idToken({ email: "weblackconsulting@gmail.com", email_verified: true }),
          ...token,
        }),
        { status: tokenStatus },
      );
    }
    return new Response(JSON.stringify({ files: [] }), { status: probeStatus });
  };
  return { fetchImpl, calls };
}

const exchange = (fetchImpl) =>
  completeAuthorization({ fetchImpl, clientId: CLIENT_ID, clientSecret: "GOCSPX-test-secret", code: "4/0Abc", verifier: "v".repeat(64), redirectUri: REDIRECT, expectedAccount: "weblackconsulting@gmail.com" });

test("échange du code : PKCE et redirection transmis, jeton de renouvellement obtenu, accès Drive testé", async () => {
  const { fetchImpl, calls } = fakeGoogle();
  assert.deepEqual(await exchange(fetchImpl), { refreshToken: "1//test-refresh" });
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "v".repeat(64));
  assert.equal(body.get("redirect_uri"), REDIRECT);
  assert.ok(calls[1].url.startsWith("https://www.googleapis.com/drive/v3/files"), "test Drive réel après l'échange");
});

test("échange du code : erreurs OAuth traitées (invalid_grant, invalid_client, redirect_uri_mismatch)", async () => {
  for (const error of ["invalid_grant", "invalid_client", "redirect_uri_mismatch"]) {
    const { fetchImpl } = fakeGoogle({ token: { error }, tokenStatus: 400 });
    await assert.rejects(exchange(fetchImpl), (e) => e instanceof OAuthError && e.code === `token_${error}` && !e.message.includes("GOCSPX"));
  }
});

test("échange du code : refus sans jeton de renouvellement, sans drive.file, mauvais compte, e-mail non vérifié, Drive inaccessible", async () => {
  await assert.rejects(exchange(fakeGoogle({ token: { refresh_token: undefined } }).fetchImpl), { code: "no_refresh_token" });
  await assert.rejects(exchange(fakeGoogle({ token: { scope: "openid email" } }).fetchImpl), { code: "scope_missing" });
  await assert.rejects(exchange(fakeGoogle({ token: { id_token: idToken({ email: "autre@gmail.com", email_verified: true }) } }).fetchImpl), { code: "wrong_account" });
  await assert.rejects(exchange(fakeGoogle({ token: { id_token: idToken({ email: "weblackconsulting@gmail.com", email_verified: false }) } }).fetchImpl), { code: "wrong_account" });
  await assert.rejects(exchange(fakeGoogle({ probeStatus: 403 }).fetchImpl), { code: "drive_probe_failed" });
});

// --- Écriture des secrets --------------------------------------------------------

test("--dry-run n'écrit aucun secret ; le mode normal écrit les trois noms attendus par le serveur", async () => {
  const written = [];
  const putSecret = async (name) => written.push(name);
  assert.deepEqual(await storeSecrets({ dryRun: true, putSecret, clientId: CLIENT_ID, clientSecret: "s".repeat(20), refreshToken: "1//r" }), []);
  assert.equal(written.length, 0);
  await storeSecrets({ dryRun: false, putSecret, clientId: CLIENT_ID, clientSecret: "s".repeat(20), refreshToken: "1//r" });
  assert.deepEqual(written, ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]);
  await assert.rejects(storeSecrets({ dryRun: false, putSecret, clientId: CLIENT_ID, clientSecret: "s".repeat(20), refreshToken: undefined }), { code: "incomplete_secrets" });
});

test("les noms de secrets écrits sont exactement ceux lus par la fonction Cloudflare", async () => {
  const { readFileSync } = await import("node:fs");
  const server = readFileSync(new URL("../../functions/lib/googleDrive.ts", import.meta.url), "utf8");
  for (const name of SECRET_NAMES) assert.ok(server.includes(`env.${name}`), name);
});

test("fichier client JSON : « installed » accepté, client Web refusé, fichier invalide refusé", () => {
  const dir = mkdtempSync(join(tmpdir(), "weblack-oauth-"));
  const desktop = join(dir, "desktop.json");
  writeFileSync(desktop, JSON.stringify({ installed: { client_id: CLIENT_ID, client_secret: "GOCSPX-x", redirect_uris: ["http://localhost"] } }));
  assert.deepEqual(readClientFile(desktop), { clientId: CLIENT_ID, clientSecret: "GOCSPX-x" });
  const web = join(dir, "web.json");
  writeFileSync(web, JSON.stringify({ web: { client_id: CLIENT_ID, client_secret: "x" } }));
  assert.throws(() => readClientFile(web), { code: "client_type_web" });
  assert.throws(() => readClientFile(join(dir, "absent.json")), { code: "client_file_unreadable" });
});

// --- Interprétation des permissions accordées ----------------------------------------

test("permissions : champ scope présent, vide ou absent — absent ne veut pas dire refusé", () => {
  assert.deepEqual(parseGrantedScopes(`openid ${DRIVE_SCOPE}`), ["openid", DRIVE_SCOPE]);
  assert.deepEqual(parseGrantedScopes(`  openid   ${DRIVE_SCOPE} `), ["openid", DRIVE_SCOPE]);
  assert.equal(parseGrantedScopes(undefined), null);
  assert.equal(parseGrantedScopes(""), null);
  assert.equal(parseGrantedScopes(42), null);
});

test("scope présent avec drive.file : accepté sans appel à tokeninfo", async () => {
  const { fetchImpl, calls } = fakeGoogle();
  await exchange(fetchImpl);
  assert.ok(!calls.some((c) => c.url.includes("tokeninfo")));
});

test("scope présent SANS drive.file (case Drive non cochée) : refus explicite listant les permissions accordées, sans jeton", async () => {
  const { fetchImpl } = fakeGoogle({ token: { scope: `openid ${EMAIL_SCOPE}` } });
  await assert.rejects(exchange(fetchImpl), (e) => {
    assert.equal(e.code, "scope_missing");
    assert.match(e.message, /Permissions accordées : openid, userinfo\.email/);
    assert.match(e.message, /cochez explicitement la case Google Drive/);
    for (const secret of ["ya29.test", "1//test-refresh", "GOCSPX-test-secret", "4/0Abc"]) {
      assert.ok(!e.message.includes(secret), `aucun jeton, secret ni code dans le message (${secret.slice(0, 4)}…)`);
    }
    return true;
  });
});

test("scope non retourné : vérification auprès de Google (tokeninfo, en POST, jeton hors URL)", async () => {
  const { fetchImpl, calls } = fakeGoogle({ token: { scope: undefined } });
  assert.deepEqual(await exchange(fetchImpl), { refreshToken: "1//test-refresh" });
  const info = calls.find((c) => c.url.includes("tokeninfo"));
  assert.ok(info && !info.url.includes("ya29"), "jeton transmis dans le corps, jamais dans l'URL");
  assert.equal(new URLSearchParams(info.body).get("access_token"), "ya29.test");
});

test("scope non retourné et tokeninfo sans drive.file : vrai refus", async () => {
  const { fetchImpl } = fakeGoogle({ token: { scope: undefined }, tokeninfo: { scope: "openid email" } });
  await assert.rejects(exchange(fetchImpl), { code: "scope_missing" });
});

test("scope non retourné et tokeninfo indisponible : l'accès Drive réel tranche (succès ou refus)", async () => {
  for (const tokeninfo of ["fail", "down"]) {
    assert.deepEqual(await exchange(fakeGoogle({ token: { scope: undefined }, tokeninfo }).fetchImpl), { refreshToken: "1//test-refresh" }, tokeninfo);
    await assert.rejects(exchange(fakeGoogle({ token: { scope: undefined }, tokeninfo, probeStatus: 403 }).fetchImpl), { code: "drive_probe_failed" });
  }
});

test("réponse d'échange sans jeton d'accès : erreur d'échange, pas un faux « scope manquant »", async () => {
  await assert.rejects(exchange(fakeGoogle({ token: { access_token: undefined } }).fetchImpl), { code: "invalid_token_response" });
});

// --- Serveur local de redirection : fermeture unique et propre ------------------------

async function startServer(timeoutMs = 5000) {
  const state = "etat-test-0123456789abcdef";
  let redirectUri;
  const handle = waitForAuthorizationCode({ state, timeoutMs, onListening: (uri) => (redirectUri = uri) });
  while (!redirectUri) await new Promise((r) => setTimeout(r, 5));
  return { ...handle, state, redirectUri };
}

test("serveur local : retour valide → code reçu, serveur fermé, un second appel ne fait rien planter", async () => {
  const { promise, server, state, redirectUri } = await startServer();
  const other = await fetch(redirectUri.replace("/callback", "/favicon.ico"));
  assert.equal(other.status, 404, "une autre route ne règle pas l'attente");
  const res = await fetch(`${redirectUri}?code=4%2F0Abc&state=${state}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await promise, { code: "4/0Abc", redirectUri });
  await new Promise((r) => setImmediate(r));
  assert.equal(server.listening, false);
  await assert.rejects(fetch(`${redirectUri}?code=x&state=${state}`), "serveur fermé : connexion refusée, pas de crash");
});

test("serveur local : state falsifié ou refus Google → rejet unique, serveur fermé", async () => {
  for (const query of ["code=abc&state=faux", "error=access_denied&state=etat-test-0123456789abcdef"]) {
    const { promise, server, redirectUri } = await startServer();
    const settled = promise.then(() => "ok", (e) => e.code);
    const res = await fetch(`${redirectUri}?${query}`);
    assert.equal(res.status, 400);
    assert.match(await settled, /state_mismatch|google_access_denied/);
    await new Promise((r) => setImmediate(r));
    assert.equal(server.listening, false);
  }
});

test("serveur local : délai dépassé → rejet « timeout », serveur fermé ; fermetures multiples sans erreur", async () => {
  const { promise, server, shutdown } = await startServer(50);
  await assert.rejects(promise, { code: "timeout" });
  assert.equal(server.listening, false);
  shutdown();
  shutdown();
});

test("serveur local : un rejet survenu AVANT que l'appelant n'attende ne provoque pas de « unhandled rejection »", async () => {
  const { promise, server, redirectUri } = await startServer();
  await fetch(`${redirectUri}?code=abc&state=faux`);
  await new Promise((r) => setTimeout(r, 20)); // le rejet a eu lieu, personne n'attendait encore
  await assert.rejects(promise, { code: "state_mismatch" });
  assert.equal(server.listening, false);
});
