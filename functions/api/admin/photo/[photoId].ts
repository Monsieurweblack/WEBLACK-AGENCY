import { requireAdmin, UUID_RE } from "../../../lib/adminSession.ts";
import { getPhoto } from "../../../lib/photos.ts";

interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

/**
 * Seule porte de sortie des octets d'une photo de candidature. Aucune URL
 * publique ni "difficile à deviner" : cette route revérifie la session
 * admin à CHAQUE appel, jamais seulement à l'ouverture de la page. Un
 * cookie expiré, révoqué ou absent = 401, quel que soit le photoId.
 *
 * Contrôle au niveau de la ressource : seule une photo rattachée à un
 * dossier enregistré est servie. Un envoi temporaire (formulaire non
 * soumis) n'est lisible par personne, même connecté.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET, env.PHOTOS);
  if (denied) return denied;

  const photoId = params.photoId;
  if (typeof photoId !== "string" || !UUID_RE.test(photoId)) return new Response("Bad request", { status: 400 });

  const linked = await env.DB.prepare(`SELECT id FROM application_photos WHERE id = ?`).bind(photoId).first<{ id: string }>();
  if (!linked) return new Response("Not found", { status: 404 });

  const photo = await getPhoto(env.PHOTOS, photoId);
  if (!photo) return new Response("Not found", { status: 404 });

  const buffer = photo.bytes.buffer.slice(photo.bytes.byteOffset, photo.bytes.byteOffset + photo.bytes.byteLength) as ArrayBuffer;
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, no-store",
      // Jamais affichée dans un <img> d'un autre site : une page admin
      // compromise par ailleurs ne doit pas pouvoir exfiltrer la photo via
      // un simple lien.
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
};
