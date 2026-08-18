// Décodeur PNG minimal, vers du RGBA brut.
//
// Pourquoi ce fichier existe : `expo-image-manipulator` ne donne accès à
// aucun pixel (vérifié dans la doc SDK 56), seulement à une URI ou à du
// base64. Or le scanner doit calculer un pHash, donc lire des pixels. On
// demande donc un PNG à l'ImageManipulator et on le décode ici.
//
// PNG et pas JPEG : décoder du JPEG en JavaScript pur demande un décodeur
// DCT complet, alors qu'un PNG se ramène à « inflate + défiltrage ». Et le
// PNG est sans perte, ce qui évite d'ajouter du bruit de compression juste
// avant de hacher.
//
// Portée volontairement réduite à ce que produit l'ImageManipulator :
// profondeur 8 bits, non entrelacé. Tout le reste lève une erreur explicite
// plutôt que de renvoyer des pixels faux.

import { inflate } from 'pako';

export type DecodedImage = { data: Uint8Array; width: number; height: number };

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Nombre de canaux par type de couleur PNG. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  );
}

/** Prédicteur Paeth (filtre 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Décode un PNG (base64 ou octets) en RGBA entrelacé. */
export function decodePng(source: Uint8Array): DecodedImage {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (source[i] !== SIGNATURE[i]) throw new Error("Ce n'est pas un fichier PNG.");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset < source.length) {
    const length = readUint32(source, offset);
    const type = String.fromCharCode(
      source[offset + 4],
      source[offset + 5],
      source[offset + 6],
      source[offset + 7]
    );
    const body = source.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = readUint32(body, 0);
      height = readUint32(body, 4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length; // longueur + type + données + CRC
  }

  if (bitDepth !== 8) throw new Error(`PNG ${bitDepth} bits non géré (8 attendu).`);
  if (interlace !== 0) throw new Error('PNG entrelacé non géré.');
  if (!(colorType in CHANNELS)) throw new Error(`Type de couleur PNG ${colorType} inconnu.`);
  if (colorType === 3 && !palette) throw new Error('PNG indexé sans palette.');

  // Concaténation des IDAT avant inflate : le flux zlib est découpé en
  // chunks arbitraires, chacun pris isolément n'est pas décompressable.
  let total = 0;
  for (const part of idat) total += part.length;
  const deflated = new Uint8Array(total);
  let cursor = 0;
  for (const part of idat) {
    deflated.set(part, cursor);
    cursor += part.length;
  }
  const raw = inflate(deflated);

  const channels = CHANNELS[colorType];
  const bpp = channels; // 8 bits par canal
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);

  let previous = new Uint8Array(stride);
  let position = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[position++];
    const line = raw.subarray(position, position + stride);
    position += stride;

    // Défiltrage sur place, dans une copie : chaque ligne sert de référence
    // « Up » à la suivante, il lui faut donc être déjà reconstruite.
    const current = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const x = line[i];
      const a = i >= bpp ? current[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;

      switch (filter) {
        case 0:
          current[i] = x;
          break;
        case 1:
          current[i] = (x + a) & 0xff;
          break;
        case 2:
          current[i] = (x + b) & 0xff;
          break;
        case 3:
          current[i] = (x + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          current[i] = (x + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Filtre PNG ${filter} inconnu.`);
      }
    }

    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      const d = (y * width + x) * 4;

      if (colorType === 0) {
        out[d] = out[d + 1] = out[d + 2] = current[s];
        out[d + 3] = 255;
      } else if (colorType === 2) {
        out[d] = current[s];
        out[d + 1] = current[s + 1];
        out[d + 2] = current[s + 2];
        out[d + 3] = 255;
      } else if (colorType === 3) {
        const index = current[s];
        out[d] = palette![index * 3];
        out[d + 1] = palette![index * 3 + 1];
        out[d + 2] = palette![index * 3 + 2];
        out[d + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 4) {
        out[d] = out[d + 1] = out[d + 2] = current[s];
        out[d + 3] = current[s + 1];
      } else {
        out[d] = current[s];
        out[d + 1] = current[s + 1];
        out[d + 2] = current[s + 2];
        out[d + 3] = current[s + 3];
      }
    }

    previous = current;
  }

  return { data: out, width, height };
}

/** Base64 → octets. React Native fournit `atob` via son polyfill global. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
