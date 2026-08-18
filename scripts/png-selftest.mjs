// Contrôle du décodeur PNG maison (mobile/src/lib/png.ts).
//
// Le décodeur est le maillon le plus facile à casser sans s'en rendre
// compte : un défiltrage faux ne plante pas, il produit des pixels
// légèrement décalés — donc un pHash faux, donc un scanner qui ne reconnaît
// rien sans jamais lever d'erreur. On le confronte donc à des PNG produits
// par un vrai encodeur (pngjs, filtrage adaptatif : les cinq filtres sont
// exercés), pour plusieurs types de couleur et sur du contenu qui ressemble
// à une carte plutôt qu'à un aplat.
//
// Usage : node scripts/png-selftest.mjs

import { PNG } from 'pngjs';

import { decodePng } from '../mobile/src/lib/png.ts';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok && !detail ? '' : ` ${detail}`}`);
}

/** Image de test : dégradés, arêtes franches et bruit — de quoi forcer
 *  l'encodeur à changer de filtre d'une ligne à l'autre. */
function makePixels(width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const edge = x > width / 3 && x < (width * 2) / 3 && y > height / 4 ? 200 : 0;
      rgba[o] = Math.min(255, (x * 255) / width + edge);
      rgba[o + 1] = Math.min(255, (y * 255) / height + rnd() * 30);
      rgba[o + 2] = Math.min(255, ((x + y) * 255) / (width + height));
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

function encode(width, height, rgba, options) {
  const png = new PNG({ width, height, ...options });
  rgba.copy(png.data);
  return PNG.sync.write(png, options);
}

const WIDTH = 97; // largeurs impaires : de quoi révéler une erreur de stride
const HEIGHT = 61;
const pixels = makePixels(WIDTH, HEIGHT);

// --- Couleur vraie, RGBA, filtrage adaptatif -------------------------------
{
  const buffer = encode(WIDTH, HEIGHT, pixels, { colorType: 6 });
  const decoded = decodePng(new Uint8Array(buffer));

  check('RGBA — dimensions', decoded.width === WIDTH && decoded.height === HEIGHT,
    `(${decoded.width}×${decoded.height})`);

  let worst = 0;
  for (let i = 0; i < pixels.length; i++) worst = Math.max(worst, Math.abs(decoded.data[i] - pixels[i]));
  check('RGBA — pixels identiques au bit près', worst === 0, `écart max ${worst}`);
}

// --- RGB sans canal alpha --------------------------------------------------
{
  const buffer = encode(WIDTH, HEIGHT, pixels, { colorType: 2, inputHasAlpha: true });
  const decoded = decodePng(new Uint8Array(buffer));

  let worst = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    for (let c = 0; c < 3; c++) {
      worst = Math.max(worst, Math.abs(decoded.data[i * 4 + c] - pixels[i * 4 + c]));
    }
  }
  check('RGB — pixels identiques au bit près', worst === 0, `écart max ${worst}`);
  check('RGB — alpha forcé à 255', decoded.data[3] === 255 && decoded.data[decoded.data.length - 1] === 255);
}

// --- Niveaux de gris -------------------------------------------------------
{
  const gray = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const v = pixels[i * 4];
    gray[i * 4] = gray[i * 4 + 1] = gray[i * 4 + 2] = v;
    gray[i * 4 + 3] = 255;
  }
  const buffer = encode(WIDTH, HEIGHT, gray, { colorType: 0, inputHasAlpha: true });
  const decoded = decodePng(new Uint8Array(buffer));

  let worst = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) worst = Math.max(worst, Math.abs(decoded.data[i * 4] - gray[i * 4]));
  check('Gris — pixels identiques au bit près', worst === 0, `écart max ${worst}`);
}

// --- Chaîne complète : PNG -> pHash, deux encodages de la MÊME image -------
{
  const { gray32FromRgba, phashFromGray32, hamming } = await import('../mobile/src/lib/phash.ts');

  const rgbaBuf = encode(WIDTH, HEIGHT, pixels, { colorType: 6 });
  const rgbBuf = encode(WIDTH, HEIGHT, pixels, { colorType: 2, inputHasAlpha: true });

  const a = decodePng(new Uint8Array(rgbaBuf));
  const b = decodePng(new Uint8Array(rgbBuf));
  const ha = phashFromGray32(gray32FromRgba(a.data, a.width, a.height));
  const hb = phashFromGray32(gray32FromRgba(b.data, b.width, b.height));

  check('pHash identique quel que soit l’encodage PNG', hamming(ha, hb) === 0, `distance ${hamming(ha, hb)}`);
}

console.log(failures === 0 ? '\nTous les contrôles passent.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
