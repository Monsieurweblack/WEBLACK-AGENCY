/**
 * Espace membre — demande d'effacement formulée par la personne.
 *
 * Rien n'est supprimé automatiquement : la demande est inscrite dans
 * l'historique de chaque dossier et au journal d'audit, et remonte au
 * tableau de bord (« À traiter »). L'équipe l'exécute depuis la vue Contacts
 * (effacement complet, functions/lib/erasure.ts) après vérification.
 */
import { json } from "../../lib/json.ts";
import { audit } from "../../lib/audit.ts";
import { contactKey } from "../../lib/contacts.ts";
import { memberApplications, readMemberSession, sameOrigin, type MemberEnv } from "../../lib/member.ts";

export const onRequestPost: PagesFunction<MemberEnv> = async ({ request, env }) => {
  if (!sameOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const session = env.DB ? await readMemberSession(env, request) : null;
  if (!session) return json({ ok: false, reason: "unauthorized" }, 401);
  const { rows } = await memberApplications(env.DB, session.email);
  if (!rows.length) return json({ ok: false, reason: "unauthorized" }, 401);
  const now = new Date().toISOString();
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(`INSERT INTO application_events (id, application_id, created_at, kind, note) VALUES (?, ?, ?, 'erasure_request', ?)`).bind(
        crypto.randomUUID(),
        r.id,
        now,
        "Demande d'effacement formulée par la personne depuis son espace.",
      ),
    ),
  );
  await audit(env.DB, "member.erasure_request", "contact", await contactKey(session.email));
  return json({ ok: true }, 200);
};
