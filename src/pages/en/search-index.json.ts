import type { APIRoute } from "astro";
import { buildSearchIndex } from "../../lib/search";

export const GET: APIRoute = async () => {
  const entries = await buildSearchIndex("en");
  return new Response(JSON.stringify(entries), {
    headers: { "Content-Type": "application/json" },
  });
};
