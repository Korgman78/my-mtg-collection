// Détection de la carte dans la photo, puis redressement.
//
// Pourquoi c'est le levier principal, mesuré et non supposé : la fenêtre
// d'illustration est définie en FRACTIONS du rectangle analysé. Si la photo
// laisse du fond autour de la carte, la fenêtre glisse et on hache un bout de
// bordure au lieu du dessin. Balayer 25 fenêtres à l'aveugle compense mal :
// sur des photos négligées, 20/25 reconnues contre 25/25 quand on connaît les
// bords réels de la carte.
//
// Le redressement va plus loin que le recadrage : une carte photographiée de
// biais est ramenée à un rectangle parfait, donc géométriquement identique à
// l'image de référence Scryfall.
//
// Méthode, choisie pour tenir en JavaScript pur sur un téléphone :
//   1. gradient de Sobel — une carte est couverte de détail (texte,
//      illustration), une table ne l'est pas ;
//   2. flou du gradient, pour que l'intérieur de la carte devienne une masse
//      pleine plutôt qu'un contour ;
//   3. seuil, puis plus grande composante connexe ;
//   4. les quatre coins extrêmes de cette composante ;
//   5. contrôle de vraisemblance : sans un rapport proche de 63:88, on
//      refuse et l'appelant retombe sur l'ancienne méthode.
//
// Aucune dépendance : ce fichier doit tourner aussi bien dans l'app que dans
// les scripts d'évaluation Node.

export type Point = { x: number; y: number };
/** Coins dans l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche. */
export type Quad = [Point, Point, Point, Point];

export type DetectedCard = { quad: Quad; coverage: number };

const CARD_ASPECT = 63 / 88;

/** Niveaux de gris, en un seul passage. */
function toGray(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return gray;
}

/** Magnitude du gradient (Sobel). Mesure la « quantité de détail » locale. */
function sobel(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const t = gray[i - width];
      const tr = gray[i - width + 1];
      const l = gray[i - 1];
      const r = gray[i + 1];
      const bl = gray[i + width - 1];
      const b = gray[i + width];
      const br = gray[i + width + 1];

      const gx = tl + 2 * l + bl - (tr + 2 * r + br);
      const gy = tl + 2 * t + tr - (bl + 2 * b + br);
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Flou de boîte séparable. Remplit l'intérieur de la carte. */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    let count = 0;
    for (let x = -radius; x <= radius; x++) {
      if (x >= 0 && x < width) {
        sum += src[y * width + x];
        count++;
      }
    }
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / count;
      const out_ = x - radius;
      const in_ = x + radius + 1;
      if (out_ >= 0) {
        sum -= src[y * width + out_];
        count--;
      }
      if (in_ < width) {
        sum += src[y * width + in_];
        count++;
      }
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = -radius; y <= radius; y++) {
      if (y >= 0 && y < height) {
        sum += tmp[y * width + x];
        count++;
      }
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / count;
      const out_ = y - radius;
      const in_ = y + radius + 1;
      if (out_ >= 0) {
        sum -= tmp[out_ * width + x];
        count--;
      }
      if (in_ < height) {
        sum += tmp[in_ * width + x];
        count++;
      }
    }
  }

  return out;
}

/**
 * Détecte la carte. `null` si rien de convaincant : mieux vaut l'ancienne
 * méthode qu'un rectangle inventé.
 */
export function detectCard(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): DetectedCard | null {
  if (width < 40 || height < 40) return null;

  const gray = toGray(rgba, width, height);
  const edges = sobel(gray, width, height);
  // Rayon proportionnel : l'intérieur de la carte doit se remplir quelle que
  // soit la résolution de travail.
  const blurRadius = Math.max(2, Math.round(width / 32));
  const activity = boxBlur(edges, width, height, blurRadius);

  let sum = 0;
  for (const v of activity) sum += v;
  const mean = sum / activity.length;
  let variance = 0;
  for (const v of activity) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / activity.length);

  // Seuil volontairement bas : on préfère une composante trop grosse, que le
  // contrôle de vraisemblance rejettera, à une carte coupée en morceaux.
  const threshold = mean + std * 0.15;

  // Plus grande composante connexe, en 4-connexité. Pile explicite : la
  // récursion exploserait sur une image de 100 000 pixels.
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let best: number[] = [];

  for (let start = 0; start < activity.length; start++) {
    if (seen[start] || activity[start] < threshold) continue;

    const component: number[] = [];
    stack.push(start);
    seen[start] = 1;

    while (stack.length > 0) {
      const i = stack.pop()!;
      component.push(i);
      const x = i % width;
      const y = (i - x) / width;

      if (x > 0 && !seen[i - 1] && activity[i - 1] >= threshold) {
        seen[i - 1] = 1;
        stack.push(i - 1);
      }
      if (x < width - 1 && !seen[i + 1] && activity[i + 1] >= threshold) {
        seen[i + 1] = 1;
        stack.push(i + 1);
      }
      if (y > 0 && !seen[i - width] && activity[i - width] >= threshold) {
        seen[i - width] = 1;
        stack.push(i - width);
      }
      if (y < height - 1 && !seen[i + width] && activity[i + width] >= threshold) {
        seen[i + width] = 1;
        stack.push(i + width);
      }
    }

    if (component.length > best.length) best = component;
  }

  const coverage = best.length / (width * height);
  // Trop petit, c'est du bruit ; presque tout l'écran, c'est qu'on n'a rien
  // isolé du tout.
  if (coverage < 0.06 || coverage > 0.97) return null;

  // Les quatre coins : extrêmes des diagonales. Sur un quadrilatère peu
  // incliné — le cas d'une carte photographiée à plat — c'est exact et
  // infiniment plus simple qu'une enveloppe convexe.
  let tl = 0;
  let tr = 0;
  let br = 0;
  let bl = 0;
  let tlV = Infinity;
  let trV = -Infinity;
  let brV = -Infinity;
  let blV = Infinity;

  for (const i of best) {
    const x = i % width;
    const y = (i - x) / width;
    const sum2 = x + y;
    const diff = x - y;
    if (sum2 < tlV) {
      tlV = sum2;
      tl = i;
    }
    if (sum2 > brV) {
      brV = sum2;
      br = i;
    }
    if (diff > trV) {
      trV = diff;
      tr = i;
    }
    if (diff < blV) {
      blV = diff;
      bl = i;
    }
  }

  const at = (i: number): Point => ({ x: i % width, y: Math.floor(i / width) });
  const quad: Quad = [at(tl), at(tr), at(br), at(bl)];

  // Note pour la suite : rétrécir ce quadrilatère du rayon de flou, pour
  // compenser la dilatation du masque, a été essayé et MESURÉ — et ça dégrade
  // (21/25 → 15/25). L'imprécision ne vient donc pas de la dilatation mais du
  // choix des coins par extrêmes de diagonale, trop sensible à un pixel
  // aberrant. La piste sérieuse serait un ajustement de droites sur les
  // quatre bords, pas une correction globale.

  // Vraisemblance : une carte Magic a un rapport 63:88. On tolère largement
  // (perspective, détection imparfaite) mais pas n'importe quoi.
  const topW = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const bottomW = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const leftH = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const rightH = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);

  const w = (topW + bottomW) / 2;
  const h = (leftH + rightH) / 2;
  if (w < 20 || h < 20) return null;

  const ratio = w / h;
  if (ratio < CARD_ASPECT * 0.72 || ratio > CARD_ASPECT * 1.28) return null;

  return { quad, coverage };
}

/* -------------------------------------------------------------------------- */
/* Redressement                                                                */
/* -------------------------------------------------------------------------- */

/** Résout un système linéaire par élimination de Gauss avec pivot partiel. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }

  return a.map((row, i) => row[n] / row[i]);
}

/**
 * Homographie envoyant le rectangle destination sur le quadrilatère source.
 * Huit inconnues, huit équations : les quatre correspondances de coins.
 */
function homography(dst: Quad, src: Quad): number[] | null {
  const rows: number[][] = [];
  const rhs: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = src[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    rhs.push(v);
  }

  return solve(rows, rhs);
}

/**
 * Redresse le quadrilatère en un rectangle de `outW`×`outH`.
 *
 * Échantillonnage bilinéaire : une carte photographiée de biais est très
 * étirée d'un côté, et un plus proche voisin y produirait des marches
 * d'escalier que le hachage prendrait pour du détail.
 */
export function rectify(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  quad: Quad,
  outW: number,
  outH: number
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];

  const h = homography(dst, quad);
  if (!h) return null;
  const [a, b, c, d, e, f, g, i] = h;

  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = g * x + i * y + 1;
      const sx = (a * x + b * y + c) / denom;
      const sy = (d * x + e * y + f) / denom;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const o = (y * outW + x) * 4;

      if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) {
        out[o] = out[o + 1] = out[o + 2] = 0;
        out[o + 3] = 255;
        continue;
      }

      const fx = sx - x0;
      const fy = sy - y0;
      const p00 = (y0 * width + x0) * 4;
      const p10 = p00 + 4;
      const p01 = p00 + width * 4;
      const p11 = p01 + 4;

      for (let ch = 0; ch < 3; ch++) {
        const top = rgba[p00 + ch] * (1 - fx) + rgba[p10 + ch] * fx;
        const bottom = rgba[p01 + ch] * (1 - fx) + rgba[p11 + ch] * fx;
        out[o + ch] = top * (1 - fy) + bottom * fy;
      }
      out[o + 3] = 255;
    }
  }

  return { data: out, width: outW, height: outH };
}
