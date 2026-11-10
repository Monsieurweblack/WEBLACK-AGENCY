/**
 * WEBLACK Opportunities — clôture à la date limite, appliquée à la requête.
 *
 * Le contenu et le statut éditorial viennent de Sanity (source unique, lue
 * au build : src/lib/opportunities.ts). Une page statique ne sait pas que
 * sa date limite est passée tant que le site n'a pas été reconstruit ; cette
 * passerelle relit `data-status` et `data-deadline` dans le HTML servi et
 * bascule les blocs data-when="open|closed" en conséquence. Aucune base de
 * données, aucun autre état : rien à synchroniser.
 *
 * (L'ancienne table D1 `opportunities`, migrations/0008, n'est plus lue
 * depuis le passage à Sanity ; elle est conservée telle quelle — voir
 * docs/sanity-content-architecture.md.)
 */

export interface PublicState {
  closed: boolean;
}

/** Clôturée à l'instant `now` : statut autre que « en ligne », ou date limite passée. Données illisibles : clôturée. */
export function closedNow(status: string | null, deadline: string | null, now: number = Date.now()): boolean {
  const end = deadline ? Date.parse(deadline) : Number.NaN;
  return status !== "published" || Number.isNaN(end) || now > end;
}

/** Ce qu'un bloc data-when doit faire ; null = ne pas y toucher (blocs fixés au build). */
export function shouldShow(when: string | null, state: PublicState): boolean | null {
  if (when === "open") return !state.closed;
  if (when === "closed") return state.closed;
  return null;
}

const PATH_RE = /^(\/en)?\/opportunities(?:\/([a-z0-9-]+))?\/?$/;

export function parseOpportunityPath(pathname: string): { lang: "fr" | "en"; slug?: string } | null {
  const m = PATH_RE.exec(pathname);
  if (!m) return null;
  return { lang: m[1] ? "en" : "fr", slug: m[2] };
}

export async function gateOpportunities(ctx: { request: Request; next: () => Promise<Response> }): Promise<Response> {
  const response = await ctx.next();
  if (!parseOpportunityPath(new URL(ctx.request.url).pathname)) return response;
  if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;

  const now = Date.now();
  let current: PublicState | null = null;
  const rewritten = new HTMLRewriter()
    .on("[data-opportunity]", {
      element(el) {
        current = { closed: closedNow(el.getAttribute("data-status"), el.getAttribute("data-deadline"), now) };
      },
    })
    .on("[data-when]", {
      element(el) {
        if (!current) return;
        const show = shouldShow(el.getAttribute("data-when"), current);
        if (show === true) el.removeAttribute("hidden");
        else if (show === false) el.setAttribute("hidden", "");
      },
    })
    .transform(response);
  const headers = new Headers(rewritten.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}
