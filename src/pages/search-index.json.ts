import type { APIRoute } from "astro";
import { buildSearchIndex } from "../lib/search";

export const GET: APIRoute = async () => {
  const entries = await buildSearchIndex("fr");
  return new Response(JSON.stringify(entries), {
    headers: { "Content-Type": "application/json" },
  });
};
