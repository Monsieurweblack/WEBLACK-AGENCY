/**
 * Espace membre — consultation (GET) et mise à jour (PATCH) du profil privé.
 *
 * Ne renvoie jamais : notes internes, historique interne, photos, données
 * d'archivage, mensurations. La personne voit et corrige ses coordonnées,
 * ses liens, sa disponibilité et sa préférence de contact. Les mises à jour
 * portent sur le dossier le plus récent et sont tracées (historique du
 * dossier + journal d'audit, sans les valeurs).
 */
import { json } from "../../lib/json.ts";
import { audit } from "../../lib/audit.ts";
import { contactKey } from "../../lib/contacts.ts";
import { clearMemberCookie, levelOf, memberApplications, parseProfileUpdate, readMemberSession, revokeSession, sameOrigin, type MemberEnv } from "../../lib/member.ts";

interface Env extends MemberEnv {
  PHOTOS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = env.DB ? await readMemberSession(env, request) : null;
  if (!session) return json({ ok: false, reason: "unauthorized" }, 401);
  const { rows, views } = await memberApplications(env.DB, session.email);
  if (!rows.length) {
    await revokeSession(env.DB, session.id);
    return json({ ok: false, reason: "unauthorized" }, 401, { "Set-Cookie": clearMemberCookie() });
  }
  return json({ ok: true, level: levelOf(rows.map((r) => r.status)), applications: views }, 200);
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const session = env.DB ? await readMemberSession(env, request) : null;
  if (!session) return json({ ok: false, reason: "unauthorized" }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const parsed = parseProfileUpdate(body);
  if (!parsed.ok) return json({ ok: false, reason: "validation", errors: parsed.errors }, 422);

  const { rows } = await memberApplications(env.DB, session.email);
  const target = rows[0];
  if (!target) return json({ ok: false, reason: "unauthorized" }, 401);

  const now = new Date().toISOString();
  const columns = Object.keys(parsed.sets);
  const assignments = [...columns.map((c) => `${c} = ?`), "member_updated_at = ?", "updated_at = ?"];
  await env.DB.batch([
    env.DB.prepare(`UPDATE applications SET ${assignments.join(", ")} WHERE id = ?`).bind(...columns.map((c) => parsed.sets[c]), now, now, target.id),
    env.DB.prepare(`INSERT INTO application_events (id, application_id, created_at, kind, note) VALUES (?, ?, ?, 'note', ?)`).bind(
      crypto.randomUUID(),
      target.id,
      now,
      `Mise à jour par la personne depuis son espace : ${columns.join(", ")}`,
    ),
  ]);
  await audit(env.DB, "member.update", "contact", await contactKey(session.email), columns.join(","));
  return json({ ok: true }, 200);
};
