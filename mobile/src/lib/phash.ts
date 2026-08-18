// pHash perceptuel 64 bits — LE fichier partagé.
//
// Ce module est importé par DEUX exécutants qui doivent produire, au bit près,
// le même hachage pour la même image :
//   - l'app, qui hache la photo prise par le joueur (mobile/src/lib/scan.ts) ;
//   - le job de référence, qui hache les images Scryfall (scripts/hash-set.mjs,
//     via le strip-types natif de Node ≥ 22).
//
// D'où la contrainte tenue ici : aucune dépendance, aucune API de plateforme,
// que de l'arithmétique JavaScript. Si les deux côtés divergeaient d'un bit,
// la reconnaissance ne renverrait jamais rien — et rien ne le signalerait.
//
// Algorithme (pHash DCT classique) :
//   1. image ramenée à 32×32 en niveaux de gris ;
//   2. DCT-II 2D ;
//   3. bloc 8×8 en haut à gauche = les basses fréquences, ce qui survit au
//      recadrage, au JPEG et à un éclairage moyen différent ;
//   4. le terme DC (0,0) est écarté : il ne porte que la luminosité globale,
//      c'est-à-dire précisément ce qui change entre un scan et une photo ;
//   5. chaque coefficient devient un bit selon qu'il dépasse la médiane.
//
// Comparer deux hachages = distance de Hamming. Même carte photographiée :
// typiquement 0–10 bits. Deux cartes différentes : 25–35 bits.

export const HASH_BITS = 64;
export const GRID = 32;

/** Table des cosinus de la DCT, calculée une fois. */
const COS = (() => {
  const t = new Float64Array(GRID * GRID);
  for (let x = 0; x < GRID; x++) {
    for (let u = 0; u < GRID; u++) {
      t[x * GRID + u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * GRID));
    }
  }
  return t;
})();

/** DCT-II 2D séparable sur la grille 32×32. */
function dct2d(pixels: Float64Array): Float64Array {
  const rows = new Float64Array(GRID * GRID);

  // Lignes.
  for (let y = 0; y < GRID; y++) {
    for (let u = 0; u < GRID; u++) {
      let sum = 0;
      for (let x = 0; x < GRID; x++) sum += pixels[y * GRID + x] * COS[x * GRID + u];
      rows[y * GRID + u] = sum * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }

  // Colonnes.
  const out = new Float64Array(GRID * GRID);
  for (let u = 0; u < GRID; u++) {
    for (let v = 0; v < GRID; v++) {
      let sum = 0;
      for (let y = 0; y < GRID; y++) sum += rows[y * GRID + u] * COS[y * GRID + v];
      out[v * GRID + u] = sum * (v === 0 ? Math.SQRT1_2 : 1);
    }
  }

  return out;
}

/** Médiane d'un tableau court. Copie d'abord : trier l'original casserait
 *  la correspondance entre l'indice d'un coefficient et son bit. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Hachage d'une image déjà réduite à 32×32 niveaux de gris (1024 valeurs 0–255).
 * Renvoie 64 caractères '0'/'1' — la forme attendue par `bit(64)` côté Postgres.
 */
export function phashFromGray32(gray: ArrayLike<number>): string {
  if (gray.length !== GRID * GRID) {
    throw new Error(`phash : ${GRID * GRID} pixels attendus, ${gray.length} reçus.`);
  }

  const pixels = new Float64Array(GRID * GRID);
  for (let i = 0; i < pixels.length; i++) pixels[i] = gray[i];

  const freq = dct2d(pixels);

  // Bloc 8×8 des basses fréquences, DC exclu du calcul de la médiane.
  const block: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) block.push(freq[v * GRID + u]);
  }
  const threshold = median(block.slice(1));

  let bits = '';
  for (let i = 0; i < HASH_BITS; i++) bits += block[i] > threshold ? '1' : '0';
  return bits;
}

/** Niveaux de gris perceptuels depuis du RGBA entrelacé (Rec. 601). */
export function grayFromRgba(rgba: ArrayLike<number>, pixelCount: number): Float64Array {
  const gray = new Float64Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    gray[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return gray;
}

/**
 * Réduction en 32×32 gris d'une RÉGION d'une image RGBA, par moyenne de boîte.
 *
 * On moyenne tous les pixels source d'une cellule plutôt que d'échantillonner :
 * un sous-échantillonnage ferait dépendre le hachage de la résolution exacte
 * de la photo, alors que la référence, elle, vient d'une image Scryfall.
 *
 * La région est passée en coordonnées plutôt que découpée en amont : le
 * scanner calcule 25 fenêtres par photo, et recopier 25 sous-images serait
 * du travail pur pour rien.
 */
export function gray32FromRegion(
  rgba: ArrayLike<number>,
  width: number,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number
): Float64Array {
  const out = new Float64Array(GRID * GRID);

  for (let cy = 0; cy < GRID; cy++) {
    const y0 = regionY + Math.floor((cy * regionH) / GRID);
    const y1 = Math.max(y0 + 1, regionY + Math.floor(((cy + 1) * regionH) / GRID));

    for (let cx = 0; cx < GRID; cx++) {
      const x0 = regionX + Math.floor((cx * regionW) / GRID);
      const x1 = Math.max(x0 + 1, regionX + Math.floor(((cx + 1) * regionW) / GRID));

      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          const o = (row + x) * 4;
          sum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
          count++;
        }
      }
      out[cy * GRID + cx] = count > 0 ? sum / count : 0;
    }
  }

  return out;
}

/** Cas courant : toute l'image. */
export function gray32FromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): Float64Array {
  return gray32FromRegion(rgba, width, 0, 0, width, height);
}

/**
 * Les fenêtres d'interrogation d'une photo.
 *
 * Mesuré sur 60 cartes (scripts/phash-eval-multicrop.mjs) : avec une seule
 * fenêtre, une photo laissant 10 % de fond autour de la carte n'est reconnue
 * que 31 fois sur 60. Avec cette échelle de fenêtres, 60/60 — et 58/60 quand
 * la carte est en plus décentrée. C'est le gain le plus important de tout le
 * scanner, très loin devant la qualité de l'éclairage.
 */
const SCALES = [1, 0.94, 0.88, 0.82, 0.76];
const CENTERS: [number, number][] = [
  [0.5, 0.5],
  [0.47, 0.5],
  [0.53, 0.5],
  [0.5, 0.47],
  [0.5, 0.53],
];

/** Les hachages d'une photo : un par fenêtre. */
export function phashWindows(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): string[] {
  const hashes: string[] = [];

  for (const scale of SCALES) {
    const w = Math.max(GRID, Math.round(width * scale));
    const h = Math.max(GRID, Math.round(height * scale));

    for (const [cx, cy] of CENTERS) {
      const x = Math.min(Math.max(0, Math.round(width * cx - w / 2)), width - w);
      const y = Math.min(Math.max(0, Math.round(height * cy - h / 2)), height - h);
      hashes.push(phashFromGray32(gray32FromRegion(rgba, width, x, y, w, h)));
    }
  }

  return hashes;
}

/** Distance de Hamming entre deux hachages en chaîne de bits. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error('Hachages de longueurs différentes.');
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
