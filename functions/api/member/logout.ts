/** Espace membre — déconnexion : session révoquée côté serveur, cookie effacé. */
import { json } from "../../lib/json.ts";
import { clearMemberCookie, readMemberSession, revokeSession, sameOrigin, type MemberEnv } from "../../lib/member.ts";

export const onRequestPost: PagesFunction<MemberEnv> = async ({ request, env }) => {
  if (!sameOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const session = env.DB ? await readMemberSession(env, request) : null;
  if (session) await revokeSession(env.DB, session.id);
  return json({ ok: true }, 200, { "Set-Cookie": clearMemberCookie() });
};
