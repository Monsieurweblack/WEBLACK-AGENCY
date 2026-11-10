/** Clôture des annonces à la date limite, appliquée à la requête — voir functions/lib/opportunities.ts. */
import { gateOpportunities } from "../../lib/opportunities.ts";

export const onRequestGet: PagesFunction = (ctx) => gateOpportunities({ request: ctx.request, next: () => ctx.next!() });
