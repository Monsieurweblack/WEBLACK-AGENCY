/**
 * WEBLACK Opportunities — état de publication (migrations/0008).
 *
 * Le texte des annonces est dans src/data/opportunities.ts ; la base ne
 * porte que le statut et la confirmation de l'organisateur. Ce module
 * décide, pour une annonce, si elle est servie et dans quel état, puis
 * applique cet état au HTML statique (HTMLRewriter, à la requête).
 */
import { OPPORTUNITIES } from "../../src/data/opportunities.ts";
import { json } from "./json.ts";

export const OPPORTUNITY_STATUSES = ["draft", "review", "published", "closed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export interface OpportunityRow {
  slug: string;
  status: OpportunityStatus;
  organizer_verified: number;
  updated_at: string;
}

export interface PublicState {
  closed: boolean;
  verified: boolean;
}

export const isOpportunityStatus = (v: unknown): v is OpportunityStatus => typeof v === "string" && (OPPORTUNITY_STATUSES as readonly string[]).includes(v);

/** Seules les annonces présentes dans le contenu peuvent avoir un statut. */
export const isKnownOpportunity = (slug: unknown): slug is string => typeof slug === "string" && OPPORTUNITIES.some((o) => o.slug === slug);

/**
 * État public d'une annonce, ou null si elle ne doit pas être servie
 * (absente du contenu, sans ligne en base, brouillon ou en vérification).
 * Publiée mais date limite passée : clôturée, sans intervention.
 */
export function publicState(slug: string, row: OpportunityRow | undefined, now: number = Date.now()): PublicState | null {
  const content = OPPORTUNITIES.find((o) => o.slug === slug);
  if (!content || !row) return null;
  if (row.status !== "published" && row.status !== "closed") return null;
  return { closed: row.status === "closed" || now > Date.parse(content.deadline), verified: row.organizer_verified === 1 };
}

/** Ce qu'un bloc data-when doit faire pour un état donné. */
export function shouldShow(when: string | null, state: PublicState): boolean {
  switch (when) {
    case "open":
      return !state.closed;
    case "closed":
      return state.closed;
    case "verified":
      return state.verified;
    case "pending":
      return !state.verified;
    default:
      return true;
  }
}

const PATH_RE = /^(\/en)?\/opportunities(?:\/([a-z0-9-]+))?\/?$/;

export function parseOpportunityPath(pathname: string): { lang: "fr" | "en"; slug?: string } | null {
  const m = PATH_RE.exec(pathname);
  if (!m) return null;
  return { lang: m[1] ? "en" : "fr", slug: m[2] };
}

export async function loadRows(db: D1Database): Promise<Map<string, OpportunityRow>> {
  const { results } = await db.prepare(`SELECT slug, status, organizer_verified, updated_at FROM opportunities`).all<OpportunityRow>();
  return new Map((results ?? []).map((r) => [r.slug, r]));
}

interface GateEnv {
  DB: D1Database;
  ASSETS?: { fetch(input: Request | string): Promise<Response> };
}

async function notFound(request: Request, env: GateEnv, lang: "fr" | "en"): Promise<Response> {
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  try {
    const page = await env.ASSETS?.fetch(new URL(lang === "en" ? "/en/404/" : "/404", request.url).toString());
    if (page?.ok) return new Response(page.body, { status: 404, headers });
  } catch {
    // page 404 indisponible : réponse minimale ci-dessous
  }
  return new Response("Not found", { status: 404, headers });
}

/**
 * Passerelle des pages /opportunities/ et /en/opportunities/ : 404 pour une
 * annonce non publiée ; sinon page statique dont les blocs data-when sont
 * montrés ou masqués selon l'état. Base illisible : 503 (jamais servir une
 * annonce dont on ne connaît pas le statut).
 */
export async function gateOpportunities(ctx: { request: Request; env: GateEnv; next: () => Promise<Response> }): Promise<Response> {
  const { request, env, next } = ctx;
  const target = parseOpportunityPath(new URL(request.url).pathname);
  if (!target) return next();

  let rows: Map<string, OpportunityRow>;
  try {
    rows = await loadRows(env.DB);
  } catch {
    return new Response("Service temporarily unavailable", { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  }
  const now = Date.now();
  if (target.slug && !publicState(target.slug, rows.get(target.slug), now)) return notFound(request, env, target.lang);

  const response = await next();
  if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;

  let current: PublicState | null = null;
  let listed = 0;
  const rewritten = new HTMLRewriter()
    .on("[data-opportunity]", {
      element(el) {
        const slug = el.getAttribute("data-opportunity") ?? "";
        current = publicState(slug, rows.get(slug), now);
        if (current) listed++;
        else el.remove();
      },
    })
    .on("[data-when]", {
      element(el) {
        if (!current) return;
        if (shouldShow(el.getAttribute("data-when"), current)) el.removeAttribute("hidden");
        else el.setAttribute("hidden", "");
      },
    })
    .on("[data-opportunities-empty]", {
      element(el) {
        if (listed === 0) el.removeAttribute("hidden");
      },
    })
    .transform(response);
  const headers = new Headers(rewritten.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

/** Liste pour le tableau de bord : chaque annonce du contenu, avec son état en base (ou absent). */
export async function adminList(db: D1Database): Promise<Response> {
  const rows = await loadRows(db);
  return json(
    {
      ok: true,
      opportunities: OPPORTUNITIES.map((o) => {
        const row = rows.get(o.slug);
        return {
          slug: o.slug,
          title: o.text.fr.title,
          deadline: o.deadline,
          status: row?.status ?? null,
          organizerVerified: row?.organizer_verified === 1,
          updatedAt: row?.updated_at ?? null,
          deadlinePassed: Date.now() > Date.parse(o.deadline),
        };
      }),
    },
    200,
  );
}
