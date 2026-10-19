/**
 * Client Google Drive minimal (API REST v3), sans dépendance — même choix
 * que sanity.ts et email.ts : quelques requêtes HTTP ne justifient pas un SDK
 * pensé pour Node.
 *
 * Authentification : OAuth 2.0 « hors ligne » du compte Google propriétaire
 * de l'archive (weblackconsulting@gmail.com). Un jeton de renouvellement,
 * obtenu une fois par scripts/google-drive/authorize.mjs, vit uniquement
 * dans les secrets Cloudflare ; chaque exécution en tire un jeton d'accès
 * de courte durée, gardé en mémoire le temps de la requête — jamais stocké,
 * jamais journalisé.
 *
 * Portée : drive.file uniquement. L'application ne voit QUE les fichiers
 * et dossiers qu'elle a créés elle-même — rien d'autre du Drive du compte.
 * Pas de compte de service : il n'a pas d'espace dans un Drive personnel.
 *
 * Erreurs : jamais le message brut de Google (il peut citer un nom de
 * fichier) — seulement un code technique stable (voir DriveError.code).
 */

export interface DriveEnv {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
}

export function driveConfigured(env: DriveEnv): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_DRIVE_REFRESH_TOKEN);
}

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/**
 * URI de redirection enregistrée dans Google Cloud (client OAuth « Application
 * Web ») — Google exige une correspondance exacte : https, domaine nu, pas de
 * barre finale. Servie par functions/api/admin/google-drive/callback.ts.
 */
export const DRIVE_OAUTH_REDIRECT_URI = "https://weblack.fr/api/admin/google-drive/callback";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const TIMEOUT_MS = 20_000;

export class DriveError extends Error {
  readonly code: string;
  /** false = inutile de réessayer sans intervention humaine (autorisation révoquée, client invalide). */
  readonly retryable: boolean;
  constructor(code: string, retryable = true) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface DriveFile {
  id: string;
  name?: string;
  size?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface DrivePermission {
  id: string;
  type: string; // user | group | domain | anyone
  role: string;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new DriveError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network");
  }
}

/** Code stable à partir d'une réponse d'erreur Drive — raison Google (ex. storageQuotaExceeded), jamais le message. */
async function driveFailure(response: Response): Promise<DriveError> {
  let reason = "";
  try {
    const body = (await response.json()) as { error?: { errors?: { reason?: unknown }[]; status?: unknown } };
    const raw = body.error?.errors?.[0]?.reason ?? body.error?.status;
    if (typeof raw === "string" && /^[A-Za-z_]{1,48}$/.test(raw)) reason = raw;
  } catch {
    // Corps illisible : le code HTTP suffit.
  }
  if (response.status === 401) return new DriveError("drive_unauthorized");
  if (response.status === 429) return new DriveError("drive_rate_limited");
  if (response.status === 403 && /quota|RateLimit/i.test(reason)) return new DriveError(`drive_quota:${reason}`);
  if (response.status === 404) return new DriveError("drive_not_found");
  return new DriveError(`drive_http_${response.status}${reason ? `:${reason}` : ""}`);
}

export class DriveClient {
  private accessToken: string | undefined;
  private readonly env: Required<DriveEnv>;

  constructor(env: DriveEnv) {
    if (!driveConfigured(env)) throw new DriveError("not_configured", false);
    this.env = env as Required<DriveEnv>;
  }

  /** Jeton d'accès (1 h) tiré du jeton de renouvellement. Erreurs OAuth distinguées : révoqué/expiré ≠ panne. */
  async token(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const response = await call(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: this.env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: this.env.GOOGLE_DRIVE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    let body: { access_token?: unknown; error?: unknown; scope?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // traité ci-dessous
    }
    if (!response.ok || typeof body.access_token !== "string") {
      // invalid_grant : jeton révoqué, expiré (application restée en mode « Test »), ou mot de passe changé.
      if (body.error === "invalid_grant") throw new DriveError("oauth_invalid_grant", false);
      if (body.error === "invalid_client" || body.error === "unauthorized_client") throw new DriveError("oauth_invalid_client", false);
      throw new DriveError(`oauth_http_${response.status}`);
    }
    if (typeof body.scope === "string" && !body.scope.split(" ").includes(DRIVE_SCOPE)) throw new DriveError("oauth_scope_missing", false);
    this.accessToken = body.access_token;
    return this.accessToken;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.token()}`);
    const response = await call(url, { ...init, headers });
    if (!response.ok) throw await driveFailure(response);
    return (await response.json()) as T;
  }

  /** Fichiers/dossiers créés par l'application, filtrés par une propriété d'application (appProperties). */
  async findByProperty(key: string, value: string, parentId?: string): Promise<DriveFile[]> {
    const clauses = [`appProperties has { key='${key}' and value='${value}' }`, "trashed = false"];
    if (parentId) clauses.push(`'${parentId}' in parents`);
    const params = new URLSearchParams({ q: clauses.join(" and "), fields: "files(id,name,size,trashed,parents,appProperties)", pageSize: "100", spaces: "drive" });
    return (await this.request<{ files: DriveFile[] }>(`${API}/files?${params}`)).files ?? [];
  }

  async listChildren(folderId: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,size,trashed,parents,appProperties)",
      pageSize: "100",
      spaces: "drive",
    });
    return (await this.request<{ files: DriveFile[] }>(`${API}/files?${params}`)).files ?? [];
  }

  async createFolder(name: string, parentId: string | undefined, appProperties: Record<string, string>): Promise<DriveFile> {
    return this.request<DriveFile>(`${API}/files?fields=id,name,parents,appProperties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}), appProperties }),
    });
  }

  /** Téléversement multipart (métadonnées + contenu) — adapté aux fichiers de quelques Mo. */
  async upload(name: string, parentId: string, mimeType: string, bytes: Uint8Array, appProperties: Record<string, string>): Promise<DriveFile> {
    const boundary = `weblack-${crypto.randomUUID()}`;
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId], appProperties })}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    return this.request<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=id,name,size,parents,appProperties`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async getFile(id: string): Promise<DriveFile> {
    return this.request<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=id,name,size,trashed,parents,appProperties`);
  }

  async listPermissions(id: string): Promise<DrivePermission[]> {
    return (await this.request<{ permissions: DrivePermission[] }>(`${API}/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type,role)`)).permissions ?? [];
  }

  /** Corbeille (récupérable 30 jours), jamais une suppression définitive. */
  async trash(id: string): Promise<void> {
    await this.request<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}
