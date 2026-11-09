/**
 * GA4 Data API — lecture seule, côté serveur uniquement.
 *
 * Accès par compte de service Google (aucun utilisateur humain, aucun jeton
 * de rafraîchissement) : la fonction signe elle-même un JWT RS256 (WebCrypto)
 * avec la clé privée du compte, l'échange contre un jeton d'accès limité à
 * `analytics.readonly`, puis interroge la propriété. Rien de tout cela
 * n'atteint le navigateur : l'API d'administration ne renvoie que des
 * chiffres agrégés.
 *
 * Configuration (secrets Cloudflare Pages, jamais dans le dépôt) :
 *   GA4_PROPERTY_ID           identifiant numérique de la propriété (ex. 123456789)
 *   GA4_SERVICE_ACCOUNT_JSON  fichier de clé JSON du compte de service
 * Le compte de service doit être ajouté à la propriété GA4 avec le seul
 * rôle « Lecteur » (Viewer). Voir docs/relationship-engine.md.
 */

export interface Ga4Env {
  GA4_PROPERTY_ID?: string;
  GA4_SERVICE_ACCOUNT_JSON?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export class Ga4Error extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function ga4Configured(env: Ga4Env): boolean {
  return Boolean(env.GA4_PROPERTY_ID && /^\d{4,20}$/.test(env.GA4_PROPERTY_ID) && env.GA4_SERVICE_ACCOUNT_JSON);
}

function parseServiceAccount(raw: string): ServiceAccount {
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    throw new Ga4Error("invalid_service_account");
  }
  if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") throw new Ga4Error("invalid_service_account");
  return sa as ServiceAccount;
}

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new Ga4Error("invalid_private_key");
  }
  try {
    return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new Ga4Error("invalid_private_key");
  }
}

/** JWT signé pour l'échange OAuth (RFC 7523), valable 5 minutes. */
export async function signedAssertion(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 300,
    }),
  );
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(signature)}`;
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  // Signée avant l'appel : une clé illisible reste « invalid_private_key », jamais une erreur réseau.
  const assertion = await signedAssertion(sa);
  let response: Response;
  try {
    response = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Ga4Error("token_network");
  }
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Ga4Error(`token_${typeof body.error === "string" && /^[a-z_]{1,40}$/.test(body.error) ? body.error : response.status}`);
  }
  return body.access_token;
}

interface ReportRow {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

async function runReport(token: string, propertyId: string, request: Record<string, unknown>): Promise<ReportRow[]> {
  let response: Response;
  try {
    response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Ga4Error("report_network");
  }
  const body = (await response.json().catch(() => ({}))) as { rows?: ReportRow[]; error?: { status?: string } };
  if (!response.ok) throw new Ga4Error(`report_${body.error?.status && /^[A-Z_]{1,40}$/.test(body.error.status) ? body.error.status : response.status}`);
  return body.rows ?? [];
}

/** Les conversions suivies par le site (src/scripts/analytics.ts) — liste fermée, aucune donnée personnelle. */
export const TRACKED_EVENTS = [
  "service_cta_click",
  "business_inquiry_start",
  "business_inquiry_success",
  "talent_application_start",
  "talent_application_success",
] as const;

export interface AudienceReport {
  period: { startDate: string; endDate: string; days: number };
  totals: { activeUsers: number; sessions: number; pageViews: number };
  channels: { channel: string; sessions: number }[];
  conversions: { event: string; count: number }[];
}

const num = (v: string | undefined) => (v === undefined ? 0 : Number(v) || 0);

export async function fetchAudience(env: Ga4Env, days = 28): Promise<AudienceReport> {
  if (!ga4Configured(env)) throw new Ga4Error("not_configured");
  const sa = parseServiceAccount(env.GA4_SERVICE_ACCOUNT_JSON!);
  const token = await accessToken(sa);
  const range = [{ startDate: `${days}daysAgo`, endDate: "yesterday" }];
  const property = env.GA4_PROPERTY_ID!;

  const [totals, channels, events] = await Promise.all([
    runReport(token, property, { dateRanges: range, metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }] }),
    runReport(token, property, {
      dateRanges: range,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
    runReport(token, property, {
      dateRanges: range,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: [...TRACKED_EVENTS] } } },
    }),
  ]);

  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const t = totals[0]?.metricValues ?? [];
  return {
    period: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), days },
    totals: { activeUsers: num(t[0]?.value), sessions: num(t[1]?.value), pageViews: num(t[2]?.value) },
    channels: channels.map((r) => ({ channel: r.dimensionValues?.[0]?.value ?? "(non défini)", sessions: num(r.metricValues?.[0]?.value) })),
    conversions: TRACKED_EVENTS.map((event) => ({
      event,
      count: num(events.find((r) => r.dimensionValues?.[0]?.value === event)?.metricValues?.[0]?.value),
    })),
  };
}
