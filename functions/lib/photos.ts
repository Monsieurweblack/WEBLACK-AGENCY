/**
 * Stockage des photos de candidature — jamais une URL publique, même
 * difficile à deviner : chaque octet ne sort du namespace KV qu'à travers
 * functions/api/admin/photo/[photoId].ts, qui vérifie une session admin à
 * CHAQUE lecture. Aucune route ne liste ni ne devine les clés.
 *
 * Interface volontairement étroite (store/get/delete) pour que migrer vers
 * R2 le jour où ce compte Cloudflare l'active (voir wrangler.toml) ne
 * touche qu'à ce fichier — aucun appelant ne connaît KV directement.
 *
 * Statut temporaire (TTL 2h) tant que la candidature n'est pas soumise : un
 * formulaire abandonné en étape 4 ne laisse pas une photo orpheline
 * indéfiniment. `promote()` retire ce TTL au moment de la soumission
 * réelle — c'est le SEUL moment où une photo devient permanente.
 */

const UPLOAD_TTL_SECONDS = 2 * 60 * 60;

export interface StoredPhoto {
  bytes: Uint8Array;
  contentType: string;
}

function keyFor(photoId: string): string {
  return `photo:${photoId}`;
}

export async function storePhoto(
  kv: KVNamespace,
  photoId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await kv.put(keyFor(photoId), bytes, {
    expirationTtl: UPLOAD_TTL_SECONDS,
    metadata: { contentType },
  });
}

export async function getPhoto(kv: KVNamespace, photoId: string): Promise<StoredPhoto | undefined> {
  const result = await kv.getWithMetadata(keyFor(photoId), "arrayBuffer");
  if (!result.value) return undefined;
  const metadata = result.metadata as { contentType?: string } | null;
  return { bytes: new Uint8Array(result.value), contentType: metadata?.contentType ?? "application/octet-stream" };
}

/** Appelé uniquement par submit.ts : retire le TTL, la photo devient permanente. */
export async function promotePhoto(kv: KVNamespace, photoId: string): Promise<boolean> {
  const existing = await getPhoto(kv, photoId);
  if (!existing) return false;
  await kv.put(keyFor(photoId), existing.bytes, { metadata: { contentType: existing.contentType } });
  return true;
}

export async function deletePhoto(kv: KVNamespace, photoId: string): Promise<void> {
  await kv.delete(keyFor(photoId));
}
