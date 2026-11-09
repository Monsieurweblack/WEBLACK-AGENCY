/**
 * GA4 Data API (lecture seule) : signature du JWT de compte de service,
 * périmètre `analytics.readonly`, agrégation des rapports, cas « non
 * configuré » et refus de Google. Aucune requête réseau réelle : fetch est
 * remplacé le temps de chaque test, avec une vraie paire de clés RSA.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchAudience, ga4Configured, Ga4Error, signedAssertion } from "./ga4.ts";
import { onRequestGet as analyticsApi } from "../api/admin/analytics.ts";
import { createSessionCookie } from "./adminSession.ts";
import { FakeKV } from "./testDoubles.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function serviceAccount() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  return { json: JSON.stringify({ client_email: "weblack-ga4@example.iam.gserviceaccount.com", private_key: pem }), publicKey: pair.publicKey };
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

test("ga4 — JWT RS256 signé, vérifiable, limité à analytics.readonly, valable 5 minutes", async () => {
  const sa = await serviceAccount();
  const jwt = await signedAssertion(JSON.parse(sa.json), 1_800_000_000);
  const [h, c, s] = jwt.split(".");
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", sa.publicKey, fromB64url(s!), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(ok, true);
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(c!)));
  assert.equal(claims.scope, "https://www.googleapis.com/auth/analytics.readonly");
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.exp - claims.iat, 300);
});

test("ga4 — non configuré : rien n'est appelé, l'API le dit", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}");
  }) as typeof fetch;
  assert.equal(ga4Configured({}), false);
  assert.equal(ga4Configured({ GA4_PROPERTY_ID: "properties/12", GA4_SERVICE_ACCOUNT_JSON: "{}" }), false);
  await assert.rejects(fetchAudience({}), (e: unknown) => e instanceof Ga4Error && e.code === "not_configured");
  const secret = "ga4-test-session-secret-0123456789";
  const cookie = (await createSessionCookie(secret)).split(";")[0]!;
  const r = await analyticsApi({ request: new Request("https://weblack.test/api/admin/analytics", { headers: { Cookie: cookie } }), env: { PHOTOS: new FakeKV(), ADMIN_SESSION_SECRET: secret }, params: {} } as never);
  assert.deepEqual(await r.json(), { ok: true, configured: false });
  assert.equal(calls, 0);
  const unauth = await analyticsApi({ request: new Request("https://weblack.test/api/admin/analytics"), env: { PHOTOS: new FakeKV(), ADMIN_SESSION_SECRET: secret }, params: {} } as never);
  assert.equal(unauth.status, 401);
});

test("ga4 — rapport agrégé : totaux, canaux, conversions suivies ; jeton jamais renvoyé", async () => {
  const sa = await serviceAccount();
  const seen: { url: string; body: string; auth: string | null }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: String(init?.body ?? ""), auth: new Headers(init?.headers).get("Authorization") });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.secret-token", expires_in: 3600 }));
    const req = JSON.parse(String(init?.body));
    if (!req.dimensions) return new Response(JSON.stringify({ rows: [{ metricValues: [{ value: "1234" }, { value: "1500" }, { value: "4200" }] }] }));
    if (req.dimensions[0].name === "sessionDefaultChannelGroup")
      return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: "Organic Search" }], metricValues: [{ value: "800" }] }, { dimensionValues: [{ value: "Direct" }], metricValues: [{ value: "500" }] }] }));
    return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: "business_inquiry_success" }], metricValues: [{ value: "3" }] }] }));
  }) as typeof fetch;
  const report = await fetchAudience({ GA4_PROPERTY_ID: "123456789", GA4_SERVICE_ACCOUNT_JSON: sa.json });
  assert.deepEqual(report.totals, { activeUsers: 1234, sessions: 1500, pageViews: 4200 });
  assert.deepEqual(report.channels, [{ channel: "Organic Search", sessions: 800 }, { channel: "Direct", sessions: 500 }]);
  assert.equal(report.conversions.find((c) => c.event === "business_inquiry_success")!.count, 3);
  assert.equal(report.conversions.find((c) => c.event === "talent_application_success")!.count, 0);
  assert.equal(report.period.days, 28);
  assert.ok(seen.filter((s) => s.url.includes("analyticsdata")).every((s) => s.url.includes("/properties/123456789:runReport") && s.auth === "Bearer ya29.secret-token"));
  assert.equal(JSON.stringify(report).includes("ya29"), false);
  assert.equal(JSON.stringify(report).includes("PRIVATE KEY"), false);
});

test("ga4 — refus de Google ou clé illisible : code technique, sans détail sensible", async () => {
  const sa = await serviceAccount();
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "secret detail" }), { status: 400 })) as typeof fetch;
  await assert.rejects(fetchAudience({ GA4_PROPERTY_ID: "123456789", GA4_SERVICE_ACCOUNT_JSON: sa.json }), (e: unknown) => e instanceof Ga4Error && e.code === "token_invalid_grant");
  await assert.rejects(
    fetchAudience({ GA4_PROPERTY_ID: "123456789", GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "x@y", private_key: "pas une clé" }) }),
    (e: unknown) => e instanceof Ga4Error && e.code === "invalid_private_key",
  );
  globalThis.fetch = (async (input: string | URL | Request) =>
    String(input).includes("oauth2")
      ? new Response(JSON.stringify({ access_token: "t" }))
      : new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "user@x has no access" } }), { status: 403 })) as typeof fetch;
  await assert.rejects(fetchAudience({ GA4_PROPERTY_ID: "123456789", GA4_SERVICE_ACCOUNT_JSON: sa.json }), (e: unknown) => e instanceof Ga4Error && e.code === "report_PERMISSION_DENIED");
});
