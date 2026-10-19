/**
 * Même convention que functions/api/newsletter.ts : jamais de cache sur une
 * réponse d'API qui décrit un acte unique (inscription, candidature, action
 * admin), toujours le même content-type.
 */
export function json(body: Record<string, unknown>, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
