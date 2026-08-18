// Le banc d'essai a montré que le cadrage domine tout le reste. Ce script
// teste la parade envisagée : au lieu d'un seul hachage, l'app en calcule
// plusieurs (le cadre, puis des recadrages successifs vers l'intérieur) et
// on retient la meilleure correspondance.
//
// Le cas simulé est celui d'une vraie photo : la carte ne remplit pas
// exactement le cadre, il reste du fond autour. On mesure combien de
// candidats il faut pour rattraper l'erreur de cadrage.
//
// Usage : node scripts/phash-eval-multicrop.mjs [set] [nb cartes]

import jpeg from 'jpeg-js';

import { gray32FromRgba, hamming, phashFromGray32 } from '../mobile/src/lib/phash.ts';

const HEADERS = { 'User-Agent': 'my-mtg-collection/0.1 (scanner eval)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRgba(url) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true });
}

/** Ajoute une marge de fond autour de la carte : la photo « trop large ». */
function pad({ data, width, height }, fraction, shade = 90) {
  const mx = Math.round(width * fraction);
  const my = Math.round(height * fraction);
  const w = width + mx * 2;
  const h = height + my * 2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = shade;
    out[i + 3] = 255;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = ((y + my) * w + (x + mx)) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
    }
  }
  return { data: out, width: w, height: h };
}

/** Décale la carte dans le cadre : le joueur ne centre jamais parfaitement. */
function shift({ data, width, height }, fx, fy, shade = 90) {
  const dx = Math.round(width * fx);
  const dy = Math.round(height * fy);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = shade;
    out[i + 3] = 255;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sy = y - dy;
      const sx = x - dx;
      if (sy < 0 || sy >= height || sx < 0 || sx >= width) continue;
      const s = (sy * width + sx) * 4;
      const d = (y * width + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
    }
  }
  return { data: out, width, height };
}

/** Fenêtre de lecture : une échelle et un centre, en fractions de l'image. */
function windowOf({ data, width, height }, scale, cx, cy) {
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const x0 = Math.min(Math.max(0, Math.round(width * cx - w / 2)), width - w);
  const y0 = Math.min(Math.max(0, Math.round(height * cy - h / 2)), height - h);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * width + (x + x0)) * 4;
      const d = (y * w + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

const crop = (img, fraction) => windowOf(img, 1 - fraction * 2, 0.5, 0.5);

const hashOf = (img) => phashFromGray32(gray32FromRgba(img.data, img.width, img.height));

/** Les fenêtres que l'app calculerait sur la photo : plusieurs échelles, et
 *  pour chacune quelques centres, parce qu'un joueur ne centre jamais pile. */
const SCALES = [1, 0.94, 0.88, 0.82, 0.76];
const CENTERS = [
  [0.5, 0.5],
  [0.47, 0.5],
  [0.53, 0.5],
  [0.5, 0.47],
  [0.5, 0.53],
];
const WINDOWS = SCALES.flatMap((s) => CENTERS.map(([cx, cy]) => [s, cx, cy]));
const CROP_LADDER = WINDOWS;

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

  const reference = [];
  for (const card of cards) {
    const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
    if (!uris.small || !uris.normal) continue;
    reference.push({ name: card.name, normal: uris.normal, hash: hashOf(await getRgba(uris.small)) });
    await sleep(110);
  }
  console.log(`Set ${setCode.toUpperCase()} — référence de ${reference.length} cartes\n`);

  const photos = [];
  for (const ref of reference) {
    photos.push({ ref, img: await getRgba(ref.normal) });
    await sleep(110);
  }

  // Photos « réalistes » : la carte occupe le cadre à peu près, pas exactement.
  const CASES = [
    ['carte pile dans le cadre', (i) => i],
    ['5 % de fond autour', (i) => pad(i, 0.05)],
    ['10 % de fond autour', (i) => pad(i, 0.1)],
    ['10 % de fond + décentrée', (i) => shift(pad(i, 0.1), 0.03, -0.02)],
  ];

  console.log(
    'cas de prise de vue'.padEnd(28) +
      '1 hachage'.padStart(11) +
      `${CROP_LADDER.length} hachages`.padStart(12) +
      'dist. moy.'.padStart(12) +
      'marge min'.padStart(11)
  );
  console.log('-'.repeat(74));

  for (const [label, makePhoto] of CASES) {
    let single = 0;
    let multi = 0;
    let distSum = 0;
    let marginMin = 64;

    for (const { ref, img } of photos) {
      const photo = makePhoto(img);
      const queries = CROP_LADDER.map(([s, cx, cy]) => hashOf(windowOf(photo, s, cx, cy)));

      // Un seul hachage : le cadre brut, sans recadrage.
      const dTrueSingle = hamming(queries[0], ref.hash);
      let dWrongSingle = 64;
      for (const o of reference) {
        if (o !== ref) dWrongSingle = Math.min(dWrongSingle, hamming(queries[0], o.hash));
      }
      if (dTrueSingle < dWrongSingle) single++;

      // Plusieurs hachages : on garde la meilleure correspondance globale.
      const best = (target) => Math.min(...queries.map((h) => hamming(h, target)));
      const dTrue = best(ref.hash);
      let dWrong = 64;
      for (const o of reference) {
        if (o !== ref) dWrong = Math.min(dWrong, best(o.hash));
      }
      if (dTrue < dWrong) multi++;
      distSum += dTrue;
      marginMin = Math.min(marginMin, dWrong - dTrue);
    }

    console.log(
      label.padEnd(28) +
        `${single}/${photos.length}`.padStart(11) +
        `${multi}/${photos.length}`.padStart(12) +
        (distSum / photos.length).toFixed(1).padStart(12) +
        String(marginMin).padStart(11)
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
