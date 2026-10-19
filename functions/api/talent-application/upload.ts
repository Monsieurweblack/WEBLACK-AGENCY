import { json } from "../../lib/json.ts";
import { checkRateLimit } from "../../lib/rateLimit.ts";
import { sniffImageType } from "../../lib/imageSniff.ts";
import { stripExifIfJpeg } from "../../lib/exif.ts";
import { storePhoto } from "../../lib/photos.ts";

/**
 * Upload d'une photo pendant la saisie (étape 04) — avant la soumission
 * finale. Chaque photo reçoit un identifiant temporaire (TTL 2h, voir
 * photos.ts) ; submit.ts les rend permanentes seulement si la candidature
 * est réellement envoyée. Un formulaire abandonné ne laisse rien de
 * permanent.
 *
 * Le réencodage canvas côté client (voir scripts/talent-application/
 * photo-upload.ts) garantit déjà un JPEG sans métadonnées et sous la
 * limite de taille — les contrôles ici ne font jamais confiance à cette
 * garantie, ils la revérifient.
 */

interface Env {
  PHOTOS: KVNamespace;
}

const MAX_BYTES = 10 * 1024 * 1024;
const VALID_ROLES = new Set(["portrait", "profile", "full_length", "extra"]);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rate = await checkRateLimit(env.PHOTOS, request, "photo-upload", 40, 60 * 60);
  if (!rate.allowed) return json({ ok: false, reason: "rate_limited" }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, reason: "invalid_form" }, 400);
  }

  const role = form.get("role");
  if (typeof role !== "string" || !VALID_ROLES.has(role)) {
    return json({ ok: false, reason: "invalid_role" }, 400);
  }

  const file = form.get("photo");
  if (!(file instanceof File)) return json({ ok: false, reason: "missing_file" }, 400);
  if (file.size === 0 || file.size > MAX_BYTES) return json({ ok: false, reason: "invalid_size" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const realType = sniffImageType(bytes);
  if (!realType) return json({ ok: false, reason: "invalid_type" }, 400);

  const cleaned = stripExifIfJpeg(bytes, realType);
  const photoId = crypto.randomUUID();
  await storePhoto(env.PHOTOS, photoId, cleaned, realType);

  return json({ ok: true, photoId }, 200);
};
