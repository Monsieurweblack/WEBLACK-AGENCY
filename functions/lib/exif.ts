/**
 * Retrait des métadonnées EXIF (localisation GPS en premier lieu) — en
 * seconde ligne, côté serveur : le navigateur réencode déjà chaque photo via
 * `<canvas>` avant l'envoi (voir scripts/talent-application/photo-upload.ts),
 * ce qui ne préserve aucune métadonnée. Mais le serveur ne fait jamais
 * confiance à ce que le client affirme avoir fait — un appel direct à cette
 * API, hors navigateur, contournerait cette étape côté client sans que
 * cette fonction-ci s'en aperçoive.
 *
 * Aucune bibliothèque d'image : l'environnement Workers n'a pas accès à des
 * dépendances natives (sharp, libvips…), et retirer l'EXIF ne nécessite pas
 * de décoder les pixels — seulement de reconnaître les marqueurs JPEG et de
 * sauter le segment APP1 qui porte l'EXIF (identifié par l'en-tête
 * "Exif\0\0"). Tout le reste du fichier traverse inchangé, octet pour octet.
 *
 * PNG ne porte pas d'EXIF au sens JPEG (quelques chunks ancillaires
 * existent en théorie, jamais écrits par un téléphone) — rien à faire ici
 * pour ce format, renvoyé tel quel.
 */
export function stripJpegExif(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes; // pas un JPEG (SOI absent)

  const segments: { start: number; end: number; keep: boolean }[] = [];
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;

    // SOS (début des données de balayage) : tout ce qui suit est la donnée
    // image elle-même, plus aucun marqueur à lire.
    if (marker === 0xda) break;
    // Marqueurs sans segment de longueur (TEM, RSTn, SOI, EOI).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      segments.push({ start: offset, end: offset + 2, keep: true });
      offset += 2;
      continue;
    }

    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const segmentEnd = offset + 2 + length;
    if (segmentEnd > bytes.length) break;

    const isExifApp1 =
      marker === 0xe1 &&
      length >= 8 &&
      bytes[offset + 4] === 0x45 && // E
      bytes[offset + 5] === 0x78 && // x
      bytes[offset + 6] === 0x69 && // i
      bytes[offset + 7] === 0x66; // f

    segments.push({ start: offset, end: segmentEnd, keep: !isExifApp1 });
    offset = segmentEnd;
  }

  const hadExif = segments.some((s) => !s.keep);
  if (!hadExif) return bytes;

  const kept = segments.filter((s) => s.keep);
  const tailStart = offset; // données de balayage + reste du fichier, après le dernier marqueur lu
  const SOI_LENGTH = 2; // les 2 premiers octets (0xFFD8) ne sont jamais poussés dans `segments` : le parcours ne commence qu'après eux.
  const totalLength = SOI_LENGTH + kept.reduce((sum, s) => sum + (s.end - s.start), 0) + (bytes.length - tailStart);

  const output = new Uint8Array(totalLength);
  output.set(bytes.subarray(0, SOI_LENGTH), 0);
  let cursor = SOI_LENGTH;
  for (const segment of kept) {
    output.set(bytes.subarray(segment.start, segment.end), cursor);
    cursor += segment.end - segment.start;
  }
  output.set(bytes.subarray(tailStart), cursor);
  return output;
}

/** Point d'entrée unique utilisé par upload.ts — décide selon le content-type réel détecté (voir imageSniff.ts), jamais selon l'extension du nom de fichier. */
export function stripExifIfJpeg(bytes: Uint8Array, contentType: string): Uint8Array {
  return contentType === "image/jpeg" ? stripJpegExif(bytes) : bytes;
}
