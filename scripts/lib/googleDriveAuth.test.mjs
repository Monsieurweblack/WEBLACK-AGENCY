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
  readClientFile,
  storeSecrets,
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

function fakeGoogle({ token = {}, tokenStatus = 200, probeStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined, headers: init?.headers });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
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
