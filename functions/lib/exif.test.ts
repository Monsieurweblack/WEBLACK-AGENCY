import { test } from "node:test";
import assert from "node:assert/strict";
import { stripJpegExif } from "./exif.ts";
import { sniffImageType } from "./imageSniff.ts";

/** Construit un faux JPEG minimal : SOI, un segment donné, SOS, un octet de "donnée image", EOI. */
function buildJpeg(segment: number[]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segment, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
}

function exifApp1Segment(payloadAfterHeader: number[]): number[] {
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...payloadAfterHeader]; // "Exif\0\0" + données
  const length = body.length + 2; // la longueur inclut les 2 octets de longueur eux-mêmes
  return [0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...body];
}

test("un JPEG réel sans EXIF traverse inchangé, octet pour octet", () => {
  const jpeg = buildJpeg([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]); // un APP0/JFIF quelconque, pas de l'EXIF
  const result = stripJpegExif(jpeg);
  assert.deepEqual(Array.from(result), Array.from(jpeg));
});

test("le segment EXIF (APP1, en-tête 'Exif\\0\\0') est retiré entièrement — c'est lui qui porte le GPS", () => {
  const exif = exifApp1Segment([0x00, 0x1a, 0x2b, 0x3c]); // données EXIF arbitraires (simule des tags GPS)
  const jpeg = buildJpeg(exif);
  const result = stripJpegExif(jpeg);

  // Le résultat ne doit plus contenir la signature "Exif\0\0" nulle part.
  const marker = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  let found = false;
  for (let i = 0; i <= result.length - marker.length; i++) {
    if (marker.every((b, j) => result[i + j] === b)) found = true;
  }
  assert.equal(found, false);

  // Le reste du fichier (SOI, SOS, données, EOI) doit toujours être un JPEG valide.
  assert.equal(result[0], 0xff);
  assert.equal(result[1], 0xd8);
  assert.equal(result[result.length - 2], 0xff);
  assert.equal(result[result.length - 1], 0xd9);
});

test("un segment APP1 qui n'est PAS de l'EXIF (en-tête différent) n'est jamais retiré par erreur", () => {
  // APP1 peut aussi porter du XMP ("http://ns.adobe.com/..."), jamais de GPS — ne doit pas être confondu avec Exif.
  const xmpBody = [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f]; // "http://" tronqué, suffisant pour ne pas matcher "Exif"
  const length = xmpBody.length + 2;
  const xmpSegment = [0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...xmpBody];
  const jpeg = buildJpeg(xmpSegment);
  const result = stripJpegExif(jpeg);
  assert.deepEqual(Array.from(result), Array.from(jpeg));
});

test("un fichier qui n'est pas un JPEG (pas de marqueur SOI) est renvoyé inchangé, jamais corrompu", () => {
  const notAJpeg = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
  assert.deepEqual(Array.from(stripJpegExif(notAJpeg)), Array.from(notAJpeg));
});

test("sniffImageType reconnaît JPEG/PNG/WebP par leurs octets réels, jamais par une extension ou un en-tête déclaré", () => {
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(
    sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    "image/png",
  );
  assert.equal(
    sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    "image/webp",
  );
  assert.equal(sniffImageType(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0, 0, 0, 0, 0])), undefined);
});
