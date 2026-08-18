// Auto-test du pHash partagé.
//
// À quoi ça sert : l'app et le job de référence importent le MÊME fichier
// (mobile/src/lib/phash.ts). Ce test fige son comportement sur un vecteur
// connu. Si quelqu'un « optimise » la DCT ou change l'ordre des bits, les
// hachages déjà en base deviennent silencieusement incomparables avec ceux
// que produit l'app — la reconnaissance ne renverrait plus rien, sans erreur.
// Ce test transforme cette panne muette en échec de CI.
//
// Node ≥ 22 : l'import d'un .ts marche grâce au strip-types natif.
//   node scripts/phash-selftest.mjs

import { CARD_ASPECT, frameRect, frameRectInPhoto } from '../mobile/src/lib/card-frame.ts';
import { GRID, hamming, phashFromGray32, gray32FromRgba } from '../mobile/src/lib/phash.ts';

// Vecteur figé le 2026-08-18. Ne se met à jour QUE si l'on change
// délibérément l'algorithme — et alors il faut re-hacher toute la référence.
const GOLDEN = '1001010000101001010010100101010101101011101010101110101101010110';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — attendu ${expected}, obtenu ${actual}`}`);
}
function checkAtMost(label, actual, max) {
  const ok = actual <= max;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label} = ${actual}${ok ? '' : ` (max toléré ${max})`}`);
}
function checkAtLeast(label, actual, min) {
  const ok = actual >= min;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label} = ${actual}${ok ? '' : ` (min attendu ${min})`}`);
}

/** Motif déterministe qui tient lieu de « carte ». */
function pattern() {
  const g = new Float64Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      g[y * GRID + x] = ((x * 7 + y * 3) % 256) * ((x + y) % 2 ? 1 : 0.6);
    }
  }
  return g;
}

const base = pattern();
const hash = phashFromGray32(base);

check('longueur du hachage', String(hash.length), '64');
check('vecteur de référence', hash, GOLDEN);

// Invariances attendues d'un pHash digne de ce nom.
checkAtMost(
  'distance après assombrissement de 20 %',
  hamming(hash, phashFromGray32(base.map((v) => v * 0.8))),
  0
);

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
checkAtMost(
  'distance avec du bruit ±10 niveaux',
  hamming(hash, phashFromGray32(base.map((v) => Math.min(255, Math.max(0, v + (rnd() - 0.5) * 20))))),
  6
);

// Deux images sans rapport doivent, elles, être loin l'une de l'autre.
const other = new Float64Array(GRID * GRID);
for (let i = 0; i < other.length; i++) other[i] = (i * 31) % 256;
checkAtLeast('distance avec une image sans rapport', hamming(hash, phashFromGray32(other)), 20);

// La réduction de boîte doit être indépendante de la résolution source :
// la même image en 320×320 et en 128×128 donne le même hachage.
function rgbaOf(size) {
  const buf = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x * GRID) / size);
      const gy = Math.floor((y * GRID) / size);
      const v = base[gy * GRID + gx];
      const o = (y * size + x) * 4;
      buf[o] = buf[o + 1] = buf[o + 2] = v;
      buf[o + 3] = 255;
    }
  }
  return buf;
}
const big = phashFromGray32(gray32FromRgba(rgbaOf(320), 320, 320));
const small = phashFromGray32(gray32FromRgba(rgbaOf(128), 128, 128));
checkAtMost('distance 320×320 vs 128×128 de la même image', hamming(big, small), 0);
check('la réduction retrouve le motif d’origine', big, hash);

/* -------------------------------------------------------------------------- */
/* Géométrie du cadre                                                          */
/*                                                                             */
/* L'aperçu caméra est affiché en « cover » : l'écran ne montre qu'une partie  */
/* de la photo. Se tromper ici fait hacher autre chose que ce que le joueur    */
/* cadre — et le symptôme est un scanner qui répond n'importe quoi, sans la    */
/* moindre erreur. C'est arrivé, d'où ces contrôles.                           */
/* -------------------------------------------------------------------------- */

console.log('');

function checkRect(label, rect, photoW, photoH) {
  const ratio = rect.width / rect.height;
  const aspectOk = Math.abs(ratio - CARD_ASPECT) < 0.01;
  const insideOk =
    rect.originX >= 0 &&
    rect.originY >= 0 &&
    rect.originX + rect.width <= photoW &&
    rect.originY + rect.height <= photoH;

  if (!aspectOk) failures++;
  if (!insideOk) failures++;
  console.log(
    `${aspectOk && insideOk ? 'ok  ' : 'FAIL'}  ${label} — ${rect.width}×${rect.height} ` +
      `à (${rect.originX},${rect.originY}), rapport ${ratio.toFixed(3)}`
  );
}

// Capteur 3:4 dans un aperçu très allongé : le cas d'un téléphone moderne.
checkRect('capteur 3000×4000, aperçu 380×620', frameRectInPhoto(3000, 4000, 380, 620), 3000, 4000);

// Capteur 16:9 couché dans un aperçu portrait : cadrage extrême.
checkRect('capteur 4000×2250, aperçu 380×620', frameRectInPhoto(4000, 2250, 380, 620), 4000, 2250);

// Aperçu minuscule : les garde-fous doivent tenir.
checkRect('capteur 1080×1920, aperçu 40×40', frameRectInPhoto(1080, 1920, 40, 40), 1080, 1920);

// Quand l'aperçu a exactement le format de la photo, il n'y a rien à
// compenser : on doit retrouver le repère tel quel.
{
  const direct = frameRect(1000, 2000);
  const mapped = frameRectInPhoto(1000, 2000, 300, 600);
  const same =
    Math.abs(direct.originX - mapped.originX) <= 1 &&
    Math.abs(direct.originY - mapped.originY) <= 1 &&
    Math.abs(direct.width - mapped.width) <= 1 &&
    Math.abs(direct.height - mapped.height) <= 1;
  if (!same) failures++;
  console.log(`${same ? 'ok  ' : 'FAIL'}  aperçu de même format que la photo → repère inchangé`);
}

// Sans dimensions d'aperçu, on retombe sur la photo entière plutôt que sur
// des coordonnées inventées.
{
  const fallback = frameRectInPhoto(1000, 2000, 0, 0);
  const expected = frameRect(1000, 2000);
  const same = JSON.stringify(fallback) === JSON.stringify(expected);
  if (!same) failures++;
  console.log(`${same ? 'ok  ' : 'FAIL'}  aperçu inconnu → repli sur la photo entière`);
}

console.log(failures === 0 ? '\nTous les contrôles passent.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
