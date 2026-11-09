/** Passerelle de statut des annonces (FR) — voir functions/lib/opportunities.ts. */
import { gateOpportunities } from "../lib/opportunities.ts";

export const onRequestGet: PagesFunction<{ DB: D1Database; ASSETS?: { fetch(input: Request | string): Promise<Response> } }> = (ctx) =>
  gateOpportunities({ request: ctx.request, env: ctx.env, next: () => ctx.next!() });
