import { requireAdmin } from "../../../lib/adminSession.ts";
import { getPhoto } from "../../../lib/photos.ts";

interface Env {
  PHOTOS: KVNamespace;
  ADMIN_SESSION_SECRET?: string;
}

/**
 * Seule porte de sortie des octets d'une photo de candidature. Aucune URL
 * publique ni "difficile à deviner" : cette route revérifie la session
 * admin à CHAQUE appel, jamais seulement à l'ouverture de la page. Un
 * cookie expiré ou absent = 401, quel que soit le photoId.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = await requireAdmin(request, env.ADMIN_SESSION_SECRET);
  if (denied) return denied;

  const photo = await getPhoto(env.PHOTOS, params.photoId as string);
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
    },
  });
};
