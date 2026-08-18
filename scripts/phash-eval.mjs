// Banc d'essai du scanner : le pHash reconnaît-il vraiment une carte
// photographiée, et avec quelle marge ?
//
// La référence est hachée depuis la PETITE image Scryfall (146×204), comme
// le fait hash-set.mjs. La « photo » est fabriquée depuis la GRANDE image
// (488×680) à laquelle on applique ce qu'un téléphone inflige réellement :
// un cadrage imparfait, une lumière différente, du bruit, un peu de flou.
// Les deux images n'ont donc ni la même résolution, ni la même compression —
// c'est bien la situation réelle qu'on mesure, pas un aller-retour truqué.
//
// Ce qu'on veut savoir, et qu'aucune intuition ne donne :
//   - le plus proche voisin est-il la bonne carte ?
//   - quelle distance sépare la bonne réponse de la première mauvaise ?
// C'est cet écart qui fixe le seuil de match_card_hash().
//
// Usage : node scripts/phash-eval.mjs [code de set] [nombre de cartes]

import jpeg from 'jpeg-js';

import { gray32FromRgba, hamming, phashFromGray32 } from '../mobile/src/lib/phash.ts';

const HEADERS = { 'User-Agent': 'my-mtg-collection/0.1 (scanner eval)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRgba(url) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return jpeg.decode(buf, { useTArray: true });
}

/* --- Déformations d'une prise de vue ------------------------------------ */

/** Recadrage : on perd une fraction de chaque bord (cadrage approximatif). */
function crop({ data, width, height }, fraction) {
  const dx = Math.round(width * fraction);
  const dy = Math.round(height * fraction);
  const w = width - dx * 2;
  const h = height - dy * 2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + dy) * width + (x + dx)) * 4;
      const d = (y * w + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Lumière : gain multiplicatif + décalage, comme une pièce mal éclairée. */
function relight({ data, width, height }, gain, offset) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = data[i] * gain + offset;
    out[i + 1] = data[i + 1] * gain + offset;
    out[i + 2] = data[i + 2] * gain + offset;
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

/** Bruit de capteur. */
function noise({ data, width, height }, amplitude, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * amplitude;
    out[i] = data[i] + n;
    out[i + 1] = data[i + 1] + n;
    out[i + 2] = data[i + 2] + n;
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

/** Flou de boîte : la main tremble, l'autofocus hésite. */
function blur({ data, width, height }, radius) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
          const o = (yy * width + xx) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          n++;
        }
      }
      const d = (y * width + x) * 4;
      out[d] = r / n;
      out[d + 1] = g / n;
      out[d + 2] = b / n;
      out[d + 3] = 255;
    }
  }
  return { data: out, width, height };
}

const hashOf = (img) => phashFromGray32(gray32FromRgba(img.data, img.width, img.height));

const SCENARIOS = [
  ['photo nette, bien cadrée', (i) => relight(i, 1.0, 0)],
  ['cadrage à 3 % près', (i) => crop(i, 0.03)],
  ['cadrage à 6 % près', (i) => crop(i, 0.06)],
  ['pénombre (gain 0,65)', (i) => relight(i, 0.65, 0)],
  ['surexposée (gain 1,35)', (i) => relight(i, 1.35, 10)],
  ['flou + bruit', (i) => noise(blur(i, 2), 18)],
  ['cumul réaliste', (i) => noise(blur(relight(crop(i, 0.04), 0.8, 5), 1), 12)],
];

async function main() {
  const setCode = (process.argv[2] ?? 'otp').toLowerCase();
  const limit = Number(process.argv[3] ?? 60);

  const q = encodeURIComponent(`set:${setCode} game:paper`);
  const page = await (
    await fetch(
      `https://api.scryfall.com/cards/search?q=${q}&unique=prints&include_variations=true&order=set`,
      { headers: HEADERS }
    )
  ).json();
  const cards = (page.data ?? []).slice(0, limit);
  console.log(`Set ${setCode.toUpperCase()} — ${cards.length} cartes évaluées\n`);

  // Référence : petite image, exactement comme le job de production.
  const reference = [];
  for (const card of cards) {
    const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
    if (!uris.small || !uris.normal) continue;
    reference.push({
      name: card.name,
      number: card.collector_number,
      normal: uris.normal,
      hash: hashOf(await getRgba(uris.small)),
    });
    await sleep(110);
  }
  console.log(`Référence construite : ${reference.length} hachages\n`);

  // Distance typique entre deux cartes différentes : c'est le bruit de fond
  // au-dessus duquel une vraie reconnaissance doit se détacher.
  let sum = 0;
  let pairs = 0;
  let closestPair = 64;
  for (let i = 0; i < reference.length; i++) {
    for (let j = i + 1; j < reference.length; j++) {
      const d = hamming(reference[i].hash, reference[j].hash);
      sum += d;
      pairs++;
      closestPair = Math.min(closestPair, d);
    }
  }
  console.log(
    `Entre cartes différentes : distance moyenne ${(sum / pairs).toFixed(1)}, ` +
      `paire la plus proche ${closestPair}\n`
  );

  // Les « photos ».
  const photos = [];
  for (const ref of reference) {
    photos.push({ ref, img: await getRgba(ref.normal) });
    await sleep(110);
  }

  console.log(
    'scénario'.padEnd(26) +
      'reconnu'.padStart(9) +
      'dist. moy.'.padStart(12) +
      'dist. max'.padStart(11) +
      'marge min'.padStart(11)
  );
  console.log('-'.repeat(69));

  for (const [label, transform] of SCENARIOS) {
    let correct = 0;
    let distSum = 0;
    let distMax = 0;
    let marginMin = 64;

    for (const { ref, img } of photos) {
      const h = hashOf(transform(img));
      const dTrue = hamming(h, ref.hash);

      let dBestWrong = 64;
      for (const other of reference) {
        if (other === ref) continue;
        dBestWrong = Math.min(dBestWrong, hamming(h, other.hash));
      }

      if (dTrue < dBestWrong) correct++;
      distSum += dTrue;
      distMax = Math.max(distMax, dTrue);
      marginMin = Math.min(marginMin, dBestWrong - dTrue);
    }

    console.log(
      label.padEnd(26) +
        `${correct}/${photos.length}`.padStart(9) +
        (distSum / photos.length).toFixed(1).padStart(12) +
        String(distMax).padStart(11) +
        String(marginMin).padStart(11)
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
